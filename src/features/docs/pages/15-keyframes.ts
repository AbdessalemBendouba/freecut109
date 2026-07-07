import type { DocPageContent } from '../docs-content'

const page = {
  order: 15,
  slug: 'keyframes',
  title: 'Keyframe Animation',
  description:
    'Animate transform, crop, text, effect, and audio values with keyframes, easing, and the curve editor.',
  category: 'Creative Tools',
  related: ['animate', 'properties', 'effects-color'],
  sections: [
    {
      title: 'Open the keyframe editor',
      blocks: [
        {
          kind: 'list',
          items: [
            'Select an item, then open the keyframe editor from the sidebar button or with `Ctrl+Shift+A`.',
            'It opens in a **Split** view: the dopesheet on top for timing and the value graph below.',
            'Switch views with **Graph** for value curves and easing, or **Sheet** to move every keyframe on one grid — the `1` and `2` keys jump between them.',
          ],
        },
      ],
    },
    {
      title: 'Add a keyframe',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Move the playhead to the frame you want to key.',
            'Type a value next to a parameter and press `Enter`, or click the **diamond** on the parameter row.',
            'Move to another frame and set a second value to create motion between them.',
            'Or turn on **auto-key** (the timer icon) to capture every value change automatically as you work.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'You cannot add a keyframe inside a transition region, or with the playhead outside the clip bounds — the diamond is disabled there.',
        },
      ],
    },
    {
      title: 'What you can animate',
      blocks: [
        {
          kind: 'table',
          headers: ['Clip type', 'Animatable values'],
          rows: [
            ['All visual clips', 'X / Y position, width, height, rotation, opacity, corner radius'],
            ['Video', 'Adds anchor point, the four crop edges, crop softness, and volume'],
            [
              'Text',
              'Adds preset scale, font size, line height, padding, background radius, shadow, and stroke',
            ],
            ['Audio', 'Volume in decibels'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Effects also contribute their own animatable parameters — look for the keyframe toggle beside each slider.',
        },
      ],
    },
    {
      title: 'Shape the motion',
      blocks: [
        {
          kind: 'list',
          items: [
            'Click the **connector** between two keyframes to open the **easing editor**.',
            'Browse preset curves under two tabs — **Cubic Easing** and **Spring**. Filter the easing presets by direction (**All / In / Out / In-Out**); each tile shows an animated preview on hover, and **Hold** freezes the value until the next key.',
            'Switch to **Edit** to shape the curve directly: drag the two control handles on the graph, or type exact values. Springs expose **tension**, **friction**, and **mass** and preview their real bounce.',
            'Feel the timing on **Position**, **Scale**, **Rotate**, or **Opacity** in the live preview, and **Pause** the loop.',
            'Save a tweaked curve as a **custom preset** with **Save As**, **Update** it later, or **Reset** back to the preset it came from. Custom presets are stored on your device and appear in every project.',
            'Copy, cut, paste, and delete keyframes, marquee-select groups, drag to retime, and `Alt`-drag to duplicate.',
          ],
        },
      ],
    },
    {
      title: 'Work in the value graph',
      blocks: [
        {
          kind: 'list',
          items: [
            'Pick a property from the dropdown to edit its curve, or leave it on all to see the others as faded overlay curves. The keyframe count for the active property shows beside it.',
            'The graph draws a labelled **grid** — frames or seconds across, values up — so you can read positions at a glance.',
            'Frame the curve with **Fit to content**, or nudge the view with **Zoom in** / **Zoom out** and the mouse wheel. **Reset view** returns to the default fit.',
            'Step through keys with the **previous** / **next** arrows, then type an exact frame (**F**) and value (**V**) for the selected keyframe.',
            'While dragging a keyframe, hold **Shift** to lock it to one axis, or **Alt** to fine-adjust.',
          ],
        },
      ],
    },
    {
      title: 'Generated motion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Some clips carry generated motion such as drift, breath, shake, or audio pulse, evaluated as they play. A clip with generated motion shows a **Bake motion** action.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Bake the motion to convert it into editable keyframes you can adjust by hand.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
