"""Convert Anime4K cnn-2x-m WebSR weights (JSON) to a self-contained ONNX graph.

Input : float32[batch, 3, height, width]  planar RGB in [0,1]
Output: float32[batch, 3, 2*height, 2*width]

The graph reproduces WebSR's shader pipeline exactly:
  conv3x4 -> 6x (CReLU + conv8x4) -> 3x (CReLU + 1x1 conv over 7 skips)
  -> DepthToSpace(2, CRD) -> add bilinear upsample of the input.
"""
import json, sys
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

OFF = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,0),(0,1),(1,-1),(1,0),(1,1)]  # (dx, dy)

def mats(flat, n):
    a = np.asarray(flat, np.float32).reshape(n, 4, 4)   # [tap][col][row] (WGSL column-major)
    return np.transpose(a, (0, 2, 1))                   # [tap][out][in]

def conv_w(taps_pos, taps_neg=None):
    """-> [out=4, in, 3, 3]; in = 4 (no activation) or 8 (CReLU: pos|neg)."""
    ic = 4 if taps_neg is None else 8
    W = np.zeros((4, ic, 3, 3), np.float32)
    for i, (dx, dy) in enumerate(OFF):
        W[:, 0:4, dy + 1, dx + 1] = taps_pos[i]
        if taps_neg is not None:
            W[:, 4:8, dy + 1, dx + 1] = taps_neg[i]
    return W

def build(weights_path, out_path):
    layers = json.load(open(weights_path))['layers']
    nodes, inits = [], []
    def init(arr, name):
        inits.append(numpy_helper.from_array(np.ascontiguousarray(arr, np.float32), name))
        return name

    names = [n for n, l in layers.items() if l['type'] == 'conv']
    first, mids, head = names[0], names[1:7], names[7:10]

    # --- first conv: 4 input channels with alpha == 1; fold that column into the bias ---
    l = layers[first]
    K = mats(l['weights'], 9)                       # [tap][out][in=4]
    b = np.asarray(l['bias'], np.float32) + K[:, :, 3].sum(axis=0)   # alpha contribution
    W = np.zeros((4, 3, 3, 3), np.float32)
    for i, (dx, dy) in enumerate(OFF):
        W[:, :, dy + 1, dx + 1] = K[i][:, 0:3]
    nodes.append(helper.make_node('Conv', ['input', init(W, 'w0'), init(b, 'b0')], ['a0'],
                                  kernel_shape=[3, 3], pads=[1, 1, 1, 1]))

    def crelu(src, tag):
        nodes.append(helper.make_node('Relu', [src], [f'{tag}_p']))
        nodes.append(helper.make_node('Neg', [src], [f'{tag}_n0']))
        nodes.append(helper.make_node('Relu', [f'{tag}_n0'], [f'{tag}_n']))
        return f'{tag}_p', f'{tag}_n'

    acts = ['a0']
    for j, name in enumerate(mids, start=1):
        p, n = crelu(acts[-1], f'c{j}')
        nodes.append(helper.make_node('Concat', [p, n], [f'x{j}'], axis=1))
        M = mats(layers[name]['weights'], 18)
        W = conv_w(M[0:9], M[9:18])
        nodes.append(helper.make_node('Conv', [f'x{j}', init(W, f'w{j}'), init(np.asarray(layers[name]['bias'], np.float32), f'b{j}')],
                                      [f'a{j}'], kernel_shape=[3, 3], pads=[1, 1, 1, 1]))
        acts.append(f'a{j}')

    # --- head: 1x1 over CReLU of all 7 skip buffers (56 channels) ---
    parts = []
    for k, a in enumerate(acts):
        p, n = crelu(a, f'h{k}')
        parts += [p, n]
    nodes.append(helper.make_node('Concat', parts, ['skip'], axis=1))

    outs = []
    for hi, name in enumerate(head):
        M = mats(layers[name]['weights'], 14)        # [2b] pos, [2b+1] neg
        W = np.zeros((4, 56, 1, 1), np.float32)
        for b_i in range(7):
            W[:, b_i*8 : b_i*8+4, 0, 0] = M[2*b_i]
            W[:, b_i*8+4 : b_i*8+8, 0, 0] = M[2*b_i + 1]
        nodes.append(helper.make_node('Conv', ['skip', init(W, f'hw{hi}'), init(np.asarray(layers[name]['bias'], np.float32), f'hb{hi}')],
                                      [f'h{hi}o'], kernel_shape=[1, 1]))
        outs.append(f'h{hi}o')

    nodes.append(helper.make_node('Concat', outs, ['res12'], axis=1))
    nodes.append(helper.make_node('DepthToSpace', ['res12'], ['residual'], blocksize=2, mode='CRD'))

    inits.append(numpy_helper.from_array(np.array([], np.float32), 'roi'))
    inits.append(numpy_helper.from_array(np.array([1, 1, 2, 2], np.float32), 'scales'))
    nodes.append(helper.make_node('Resize', ['input', 'roi', 'scales'], ['up'],
                                  mode='linear', coordinate_transformation_mode='half_pixel', nearest_mode='floor'))
    nodes.append(helper.make_node('Add', ['up', 'residual'], ['output']))

    g = helper.make_graph(nodes, 'anime4k_cnn_2x_m', 
        [helper.make_tensor_value_info('input', TensorProto.FLOAT, ['batch', 3, 'height', 'width'])],
        [helper.make_tensor_value_info('output', TensorProto.FLOAT, ['batch', 3, 'height2', 'width2'])], inits)
    m = helper.make_model(g, opset_imports=[helper.make_opsetid('', 17)])
    m.ir_version = 9
    m.producer_name = 'freecut-anime4k-convert'
    onnx.checker.check_model(m, full_check=True)
    onnx.save(m, out_path)
    print(f'wrote {out_path}')

if __name__ == '__main__':
    for v in ['rl', 'an', '3d']:
        build(f'cnn-2x-m-{v}.json', f'anime4k_cnn_2x_m_{v}.onnx')
