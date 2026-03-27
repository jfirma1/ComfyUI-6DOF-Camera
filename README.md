# ComfyUI 6DOF Camera & Character Placer

A custom node for ComfyUI that transforms a 2D panoramic image into an interactive 3D environment. Move a virtual camera with full 6 Degrees of Freedom, place a poseable character block-out into the scene, then render the result as a set of images and masks ready for inpainting workflows.

---

## ✨ Features

- **6-DoF Camera Control** — Move the camera freely in X, Y, Z and rotate on Pitch, Yaw, and Roll axes.
- **Live 3D Viewer** — An interactive Three.js viewer embedded directly in the node. Drag objects in the viewer and the ComfyUI sliders update instantly, and vice versa.
- **Point Cloud Preview** — The viewer reconstructs a 3D point cloud from the image and depth map so you can visually judge your camera placement before rendering.
- **Character Block-out** — Place a poseable skeleton stand-in into the scene, sized and positioned to match your intended subject. Use it as a reference for inpainting or ControlNet poses.
- **Custom Mesh Support** — Drop an OBJ or GLB file into the `models/` folder (or connect a Dust3r GLB path) to use a real mesh as your character block-out instead of the default skeleton.
- **Full Output Suite** — Produces a rendered view, a clean background without the character, an OpenPose skeleton image, a depth map, hole/inpaint masks, and a sampling map for round-trip editing.
- **Paste-Back Node** — A companion node (` 6DOF Inverse`) reprojects your edited view back into the original panorama at exactly the right pixel positions.

---

## 📂 Directory Structure

```text
ComfyUI/
└── custom_nodes/
    └── ComfyUI-6DOF-Camera/
        ├── __init__.py            # Registers the web directory with ComfyUI
        ├── nodes.py               # All Python logic (PyTorch rendering pipeline)
        ├── README.md              # This file
        ├── models/                # Place custom .obj or .glb meshes here
        └── web/
            └── js/
                ├── 6dof_camera.js     # Bridge: syncs viewer ↔ ComfyUI sliders
                └── viewer_template.js # Three.js 3D viewer (HTML/JS source)
```

---

## 🚀 Installation

1. Navigate to your ComfyUI custom nodes directory:
   ```bash
   cd ComfyUI/custom_nodes/
   ```

2. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/ComfyUI-6DOF-Camera.git
   ```

3. No extra dependencies are required beyond what ComfyUI already uses (`torch`, `numpy`, `PIL`).

4. Restart ComfyUI and refresh your browser.

---

## 🎮 How to Use

### Step 1 — Connect your inputs

At minimum you need:
- **image** — your source panoramic RGB image.
- **depth_map** — a corresponding depth map. Depth Anything V2/V3 is recommended.

### Step 2 — Set your depth format

Choose the correct **depth_format** to match whatever model produced your depth map (see the Settings section below). Getting this wrong will make the point cloud look like mush.

### Step 3 — Position in Setup mode

Leave the mode set to **👁️ Setup (Fast)**. In this mode the node skips the heavy Python render and just updates the viewer, so it stays snappy while you scrub sliders or drag objects around. Use the 3D viewer to find your camera angle and character placement.

### Step 4 — Render

Switch mode to **🚀 Render (High Quality)** and click Queue Prompt. The node will now do the full PyTorch reprojection and output all images and masks.

### Step 5 — Inpaint and paste back

Feed `view_image` and `inpaint_mask` into your inpainter to fill holes and add content. Then connect the edited image, the original panorama, and the `sampling_map` into the ** 6DOF Inverse** node to stitch the result back into the panorama.

---

## 🖱️ Interactive Viewer Controls

Right-click the node in the ComfyUI graph and select **🖥️ Fullscreen Viewer** for a larger working area.

### Navigation
| Action | Result |
|---|---|
| Right-click + drag | Orbit / look around |
| Scroll wheel | Fly forward / backward |

### Toolbar Buttons
| Button | What it does |
|---|---|
| 📷 Camera | Selects the camera gizmo so you can move/rotate the camera |
| 🏃 Person | Selects the character gizmo so you can move and pose the skeleton |
| 🧊 Mesh | Toggles visibility of a loaded OBJ/GLB custom mesh |
| ↺ Reset | Snaps camera back to origin (0, 0, 0) and resets the skeleton to T-pose |
| ⛶ Full | Toggles fullscreen |

### Gizmo Buttons (below toolbar)
| Button / Key | What it does |
|---|---|
| Move (T) / `T` key | Switch gizmo to translate mode |
| Rotate (R) / `R` key | Switch gizmo to rotate mode |
| `Space` | Toggle between translate and rotate |
| `M` key | Toggle custom mesh visibility |

### In Camera mode
Click anywhere in the viewer to select the camera. The gizmo arrows let you move or rotate it directly.

### In Person mode
Click a joint sphere to select it individually (IK will solve the chain). Shift-click or click empty space to grab the whole character group. Drag the gizmo to move or rotate.

---

## 🔌 Inputs — Complete Reference

### Required

| Input | Type | Description |
|---|---|---|
| **mode** | Dropdown | `👁️ Setup (Fast)` — viewer only, no render output. `🚀 Render (High Quality)` — full PyTorch render, produces all outputs. |
| **image** | IMAGE | Source panoramic RGB image. This is the texture that gets reprojected onto the point cloud and rendered from the camera's perspective. |
| **depth_map** | IMAGE | Depth map matching the source image. Drives the 3D position of every pixel in the point cloud and the reprojection. |
| **depth_format** | Dropdown | How to interpret the depth values — see detail below. |
| **auto_calibrate** | Boolean | When ON, the node estimates a scale factor by sampling the floor region of the depth map and comparing it to **camera_height**. When OFF, **manual_depth_scale** is used directly. |
| **camera_height** | Float | Only used when auto_calibrate is ON. The real-world height of the camera from the floor in metres. Used to compute the depth scale. |
| **manual_depth_scale** | Float | Only used when auto_calibrate is OFF. A direct multiplier applied to the depth map values to convert them to world-space metres. Adjust until the point cloud looks right in the viewer. |
| **pos_x / pos_y / pos_z** | Float | Camera world position. +X is right, +Y is up, -Z is forward. |
| **rot_pitch** | Float | Camera tilt up/down in degrees. |
| **rot_yaw** | Float | Camera rotation left/right in degrees. |
| **rot_roll** | Float | Camera roll (tilt sideways) in degrees. |
| **show_character** | Boolean | Toggles the character block-out on or off in both the viewer and the rendered outputs. |
| **char_x / char_y / char_z** | Float | Character world position. |
| **char_rot_yaw** | Float | Which direction the character faces, in degrees. |
| **char_height** | Float | Height of the character block-out in world units (metres). |
| **char_width** | Float | Width/radius of the character block-out. |
| **head_yaw** | Float | Rotates the head joint left or right independently of the body. |
| **left_arm_angle / right_arm_angle** | Float | Angle of each arm from the body. |
| **pose_json** | String | A JSON string containing raw joint world positions (populated automatically when you drag joints in the viewer). You can also paste pose data here to snap the skeleton to a specific pose. |
| **fov** | Float | Camera field of view in degrees. Higher values = wider lens. |
| **output_size** | Int | Resolution of all rendered output images in pixels (square). |
| **precision** | Dropdown | `Normal` renders at output_size directly. `High (Super-Sampled)` renders at 2× then downscales, producing cleaner edges at the cost of more memory and time. |
| **point_density** | Dropdown | How many source pixels are used to build the reprojection. `1x` is fastest, `2x` is recommended for quality, `4x` is slow but very dense. |
| **fill_holes** | Int | Number of dilation passes to apply to fill small holes left by reprojection gaps. Higher values fill more but may bleed colours across edges. 2–4 is a reasonable starting point. |
| **custom_mesh** | Dropdown | Select an OBJ file from the `models/` folder to use as the character block-out instead of the default skeleton. The mesh is automatically scaled to match char_height and char_width. |

### Optional

| Input | Type | Description |
|---|---|---|
| **pointcloud** | POINTCLOUD | A native `POINTCLOUD` type (e.g. from Depth Anything V3 or a compatible node). When connected, this replaces the depth-based point cloud in the viewer with a geometrically accurate reconstruction. |
| **glb_path** | STRING | File path to a `.glb` file (e.g. output from Dust3r or MASt3r). When provided, the GLB is loaded and displayed as the character mesh in the viewer. |

---

### Depth Format — Which to choose?

| Setting | Use when... |
|---|---|
| **Inverse (Standard/Relative)** | Your depth map uses the common convention where bright = close and dark = far (inverse/disparity). This is the default output of most monocular depth models like MiDaS, ZoeDepth, or standard Depth Anything V1/V2. |
| **Metric (Depth Anything 3)** | Your depth map contains true metric depth values (bright = far, in metres). Depth Anything V3 in metric mode outputs this. Use it directly without inversion. |

---

## 📤 Outputs — Complete Reference

| Output | Type | Description |
|---|---|---|
| **view_image** | IMAGE | The rendered view from your camera position. Includes the character block-out if **show_character** is ON. This is your primary output for inpainting. |
| **clean_room** | IMAGE | The same render as view_image but with the character removed. Useful as a background reference or for inpainting the background separately. |
| **openpose_image** | IMAGE | An OpenPose-format skeleton render of the character's joint positions. Feed this directly into a ControlNet OpenPose node for consistent pose-guided generation. |
| **depth_image** | IMAGE | A depth map of the rendered view (not the input panorama). Can be used with ControlNet Depth or for further compositing. |
| **inpaint_mask** | MASK | White pixels = regions in the rendered view with no source data (holes caused by reprojection, e.g. areas that were occluded or out of frame in the original image). Feed this into an inpainter to fill the gaps. |
| **char_mask** | MASK | White pixels = the character silhouette. Use this to composite the character separately, mask inpainting to the character region, or drive a ControlNet layer. |
| **sampling_map** | SAMPLING_MAP | An internal index buffer recording which pixel in the source panorama corresponds to each pixel in the rendered view. Used exclusively by the ** 6DOF Inverse** node to paste edits back. Do not try to use this as an image directly. |

---

## 🔄 The Paste-Back Workflow ( 6DOF Inverse)

The ** 6DOF Inverse** node is the companion to this node. Its purpose is to take an edited rendered view and stitch it back into the original panorama at exactly the right positions.

### Inputs

| Input | Description |
|---|---|
| **original_panorama** | The same panoramic image you fed into the camera node. |
| **edited_view** | Your inpainted or otherwise edited version of `view_image`. |
| **sampling_map** | The `sampling_map` output from the camera node — this is the glue that makes the reprojection work. |

### Outputs

| Output | Description |
|---|---|
| **merged_panorama** | The original panorama with the edited view stamped back in. Only the pixels that were visible in the rendered view are updated — everything else stays untouched. |
| **change_mask** | A mask showing which panorama pixels were written to. Useful for blending or further compositing. |

### How it works

The `sampling_map` stores, for every pixel in the rendered view, the index of the source panorama pixel it came from. On paste-back, the node simply reverses this mapping — for each rendered pixel, it writes the edited colour back to that source index. This means the edit lands in exactly the right place in panorama space, regardless of how much you moved or rotated the camera.

---

## ⚠️ Limitations

### This is not true 3D geometry

The node works by reprojecting the pixels of a 2D panorama based on a depth map estimate. This is sometimes called "2.5D" or "pseudo-3D". No actual 3D mesh is reconstructed. This means:

**Occluded regions will not appear.** If you move the camera to reveal an area that was behind an object in the original image — the back of a chair, the wall behind a person, around a corner — there is simply no pixel data for that area. The reprojection will leave holes, which the `inpaint_mask` marks for you to fill with an inpainter. The quality of that fill depends entirely on your inpainting model.

**Depth maps are estimates.** Monocular depth models like Depth Anything produce plausible but imperfect depth. Thin objects, reflective surfaces, and fine details (hair, foliage, fences) are often estimated poorly, which causes those pixels to land in the wrong world position. Large camera movements will make these artefacts more visible.

**The scene has no thickness.** Every surface is a single layer of pixels. If you move sideways you will see the "cardboard cutout" effect — objects appear to have no depth of their own and the background behind them is empty. Again, inpainting is the intended solution.

**The point cloud viewer is a preview only.** The spherical point cloud shown in the Three.js viewer is a visual aid for positioning the camera. The actual render in Render mode is a separate, more accurate PyTorch reprojection and will look different (sharper, with correct depth sorting).

**Large rotations degrade quality.** The further the camera moves from the original viewpoint, the more holes appear and the more the depth estimation errors compound. This technique works best for modest camera movements — a few steps in any direction, not a full 180° turn.

---

## 🛠️ Troubleshooting

**Viewer is black after loading**
- Make sure `__init__.py` contains the line `WEB_DIRECTORY = "./web"`.
- Ensure `viewer_template.js` exists inside `web/js/`.
- Restart ComfyUI and do a hard refresh in the browser (Ctrl+Shift+R).

**Point cloud looks like a flat disc or has a spike through the middle**
- Check your **depth_format** setting. Using Inverse mode on a metric depth map (or vice versa) will produce a collapsed or inverted cloud.
- Try adjusting **manual_depth_scale**. If the scale is wrong the depth values will all cluster near zero or stretch to infinity.

**Everything looks mirrored (left is right)**
- This is a coordinate alignment issue. The node uses -Z forward convention. Check that your depth map is not horizontally flipped relative to your image.

**Huge holes in the rendered output**
- This is expected when the camera moves significantly. Increase **fill_holes** to 4–8 to fill more of them automatically, then use your inpainting model to fill the rest.

**The OpenPose output is blank**
- The pose render is only generated in **🚀 Render (High Quality)** mode. It outputs a placeholder in Setup mode.
