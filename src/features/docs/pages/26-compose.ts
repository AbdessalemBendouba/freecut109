import type { DocPageContent } from '../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Motion Workspace',
  description: 'Build layered 2D compositions using the familiar editor shell and media library.',
  category: 'Creative Tools',
  related: ['animate', 'keyframes', 'concepts'],
  sections: [
    {
      title: 'One workspace for the whole motion job',
      blocks: [
        {
          kind: 'list',
          items: [
            '**Motion** keeps the media library, composition preview, layer timeline, properties, keyframes, graphs, and motion library together.',
            'Select a layer and open the inspector’s **Motion** tab for presets, procedural generators, text motion, baking, and saved animations.',
            'Switching to Motion never converts or replaces the regular sequence timeline; it opens the active reusable composition.',
          ],
        },
      ],
    },
    {
      title: 'Create and open a composition',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open **Motion** from the workspace switcher.',
            'Use **New composition** in the layer timeline, or open an existing composition from the media library.',
            'Drag video, audio, images, text, shapes, adjustment presets, or another composition from the media library into the layer timeline.',
          ],
        },
      ],
    },
    {
      title: 'Work with layers and properties',
      blocks: [
        {
          kind: 'list',
          items: [
            'Drag a layer span left or right to move it in time. If several layers are selected, they move together and the gesture creates one undo step.',
            'Drag the three-dot handle at the left of a layer or group to change its stacking order. Child layers stay inside their current group while reordering.',
            'Each layer has visibility, lock, solo, blend-mode, in/out, and ordering controls.',
            'Select two or more layers and choose **Group** to create a collapsible parent. Group visibility, lock, solo, and span dragging apply to its child layers; choose **Ungroup** to release them.',
            'Right-click a layer or group to rename, group or ungroup, duplicate, copy, paste, or delete it. Double-clicking its name also starts inline renaming.',
            'Expand a layer to reveal the classic dope-sheet property rows beneath the existing Motion layer header, including values, auto-key controls, navigation, and keyframe diamonds.',
            'Use the property filter above the layers to show every property or only animated properties.',
            'Click a property diamond to add or remove a keyframe at the shared playhead. One continuous playhead spans the ruler, layer bars, and expanded property lanes.',
            'Select two neighboring keyframes to expose the classic easing control, preset panel, and cubic-bezier editor for that segment.',
            'Click a property curve icon to swap its keyframe lane for an inline value curve. Click another property to switch curves, or click the active icon again to return to the dope sheet. The inline curve supports timing, easing, and Bézier-handle editing without opening a separate panel.',
          ],
        },
      ],
    },
    {
      title: 'Parent layers with a Null Object',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Click **Null Object** in the Motion layer toolbar. A Null Object is an invisible transform layer: it organizes motion but never appears in the final render.',
            'In the Motion layer stack, choose a parent from the **Parent** menu or drag the spiral Parent pick whip onto another layer. Normal assignment preserves the child layer canvas pose.',
            'Hold **Shift** while releasing the Parent pick whip to snap the child position to the parent. Hold **Alt/Option** to use the child authored local pose instead.',
            'Ctrl-click or Command-click a child Parent pick whip to detach it while preserving its current pose. Add **Alt/Option** to detach without compensation and return to the authored local pose.',
            'Move, scale, rotate, or keyframe the Null Object to control every layer parented to it as one rig.',
            'A parent chip appears on each child layer in the Motion stack. Click it to jump directly to the parent layer.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Parenting lives in the Motion layer stack, alongside layer order and timing, so there is one authoritative place to inspect, assign, or detach a parent.',
        },
      ],
    },
    {
      title: 'Link properties or write an expression',
      blocks: [
        {
          kind: 'list',
          items: [
            'The spiral beside **Parent** is the Parent pick whip: it creates a layer hierarchy. The spiral beside a property is the **Property Link** pick whip: it makes one property follow another without changing layer hierarchy.',
            'Drag a Property Link pick whip to another visible property row in Motion, the classic dope sheet, or the graph. Scalar values can link to scalar values; Position, Scale, and Anchor link as complete Vector2 values.',
            'A linked value stays orange and read-only until the link is removed. Missing sources and imported cycles fall back to the authored value instead of breaking preview or export.',
            'Click the braces button beside a property to add a sandboxed expression. The editor shows the value before and after the expression, validates errors before Apply, and lets you enable, disable, or remove the expression without deleting keyframes.',
            'Inside the expression editor, drag its separate pick whip to a property row. Motion inserts a `prop("layer-id", "property")` reference at the current text cursor instead of creating a direct link.',
            'Expressions support `value`, `preValue`, `frame`, `time`, scalar and `[x, y]` values, `+ - * /`, and deterministic `abs`, `sin`, `cos`, `min`, `max`, `clamp`, and `lerp` functions. They cannot access browser globals or run arbitrary JavaScript.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Evaluation order is keyframes, then Property Link, then expression. Preview and export use the same resolver.',
        },
      ],
    },
    {
      title: 'Choose what stays editable when reused',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Inside a reusable 2D composition, open **Exposed properties** and choose the text or colors an editor should be able to change.',
            'Place the composition in a regular sequence and select that instance.',
            'Edit those values under **Template overrides**. Each placed instance keeps its own values without changing the source composition.',
            'A blue dot marks each value that differs from the source. Reset one override beside that value, or use **Reset all overrides** to return the entire instance to its exposed source values.',
          ],
        },
      ],
    },
    {
      title: 'Use a composition in a regular edit',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A 2D composition remains a reusable composition asset. Place it in a regular sequence to trim and arrange it like a clip. Open its internal layers in Motion, or animate the composition instance as one object through its Motion properties.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Internal layer animation and whole-clip animation are independent. This lets a title animate internally while the finished title composition also moves or fades on the main edit.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
