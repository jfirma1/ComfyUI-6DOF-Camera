
# ComfyUI 6DOF Camera & Character Placer

A powerful custom node for ComfyUI that transforms 2D images into 3D environments. It allows you to move a **virtual camera** freely (6 Degrees of Freedom) and **place 3D block-out characters** into the scene for consistent inpainting and composition.

Features a **Real-Time Interactive 3D Viewer** driven by Three.js that syncs bi-directionally with ComfyUI sliders.

## ✨ Features

* **6-DoF Camera Control:** Move the camera in X, Y, Z space and rotate Pitch, Yaw, Roll.
* **Character Block-out:** Place a cylindrical "character" into the 3D scene with adjustable height, width, position, and rotation.
* **Interactive Point Cloud Viewer:**
    * **Real-Time Sync:** Dragging objects in the viewer updates ComfyUI sliders instantly. Moving sliders updates the viewer instantly.
    * **Modes:** Switch between **"👀 Setup (Fast)"** for zero-latency previewing and **"🚀 Render (High Quality)"** for the final pixel-perfect output.
    * **Smart Caching:** Only rebuilds the point cloud when the room image changes.
* **Quality & Precision:**
    * **Depth Scale:** Adjust the world scale to match the depth map estimation.
    * **Super-Sampling:** High-precision rendering options for cleaner edges.
    * **Inpainting Masks:** Automatically outputs masks for the scene and the character for easy inpainting workflows (e.g., Flux, Stable Diffusion).

## 📂 Directory Structure

Ensure your folder looks exactly like this for the web viewer to work:

```text
ComfyUI/
└── custom_nodes/
    └── ComfyUI-6DOF-Camera/
        ├── __init__.py           # Points to the web directory
        ├── nodes.py              # Main Python logic (PyTorch rendering)
        ├── README.md             # This file
        └── web/
            └── js/
                ├── 6dof_camera.js    # The "Bridge" script (Sync & Logic)
                └── viewer_template.js # The Three.js 3D Engine (HTML source)

```

## 🚀 Installation

1. **Navigate** to your ComfyUI custom nodes directory:
```bash
cd ComfyUI/custom_nodes/

```


2. **Clone** this repository (or create the folder manually):
```bash
git clone [https://github.com/yourusername/ComfyUI-6DOF-Camera.git](https://github.com/yourusername/ComfyUI-6DOF-Camera.git)

```


3. **Install Requirements:**
The node uses standard ComfyUI libraries (`torch`, `numpy`, `PIL`). No extra heavy installs are usually needed if ComfyUI is running.
4. **Restart ComfyUI** and refresh your browser.

## 🎮 How to Use

### 1. The Setup

* **Image:** Connect your source RGB image.
* **Depth Map:** Connect a depth map (using **Depth Anything V2** or similar nodes is recommended).

### 2. The Modes

* **👀 Setup (Fast):** Use this while positioning. It skips the heavy Python rendering and just outputs a placeholder, keeping the UI snappy.
* **🚀 Render (High Quality):** Switch to this before clicking "Queue Prompt" to generate the final images for your workflow.

### 3. The Interactive Viewer

The viewer appears inside the node. You can interact with it directly:

* **Camera Tool (📷):**
* **Left Click + Drag:** Move Camera (X / Z).
* **Green Cone:** Drag to adjust Height (Y).
* **Cyan Ring:** Drag to Rotate (Yaw).


* **Character Tool (👤):**
* **Left Click + Drag:** Move Character (X / Z).
* **Green Cone:** Adjust Character Height.
* **Cyan Ring:** Rotate Character facing direction.


* **Navigation:**
* **Right Click + Drag:** Orbit the view (look around).
* **Scroll Wheel:** Fly forward/backward.


* **Toolbar:**
* **👁️ Eye Icon:** Toggle character visibility to inspect the background.
* **↺ Reset:** Snap everything back to origin (0,0,0).



**Pro Tip:** Right-click the node itself in the ComfyUI graph and select **"🖥️ Fullscreen Viewer"** for a large immersive view.

## 🔌 Inputs & Sliders

| Input | Description |
| --- | --- |
| **pos_x / y / z** | Camera position coordinates. |
| **rot_pitch / yaw / roll** | Camera rotation (Yaw is standard left/right turning). |
| **char_x / y / z** | Character position. |
| **char_rot_yaw** | Character facing direction. |
| **char_height / width** | Dimensions of the character cylinder. |
| **depth_scale** | **Crucial:** Adjusts how "deep" the room feels. Match this visually in the viewer until the floor looks flat. |
| **fov** | Field of view (Camera Zoom). |

## 🛠️ Troubleshooting

* **Viewer is black?**
* Make sure `__init__.py` has the line `WEB_DIRECTORY = "./web"`.
* Ensure `viewer_template.js` is inside `web/js/`.
* Restart ComfyUI and clear browser cache.




* **"Mirror" effect (Left is Right)?**
* The node logic has been updated to align Three.js and PyTorch coordinates. Ensure you are using the latest `nodes.py`.




```

```