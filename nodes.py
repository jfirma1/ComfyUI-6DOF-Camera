import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image, ImageDraw
import base64
import io
import os
import json
import math

class Qwen6DOFCamera:
    """
    6-DoF Camera Node for ComfyUI.
    - COORDS: -Z is Forward.
    - NEW: Accepts DA3 POINTCLOUD input for accurate 3D reconstruction.
    - NEW: Accepts Dust3r GLB input via glb_path.
    - Supports 'Metric' depth (Depth Anything 3) directly.
    - OBJ mesh preview in Three.js viewer.
    """

    @classmethod
    def INPUT_TYPES(cls):
        node_path = os.path.dirname(os.path.realpath(__file__))
        models_path = os.path.join(node_path, "models")
        mesh_list = ["None"]
        if os.path.exists(models_path):
            mesh_list += [f for f in os.listdir(models_path) if f.lower().endswith('.obj')]
            
        return {
            "required": {
                "mode": (["👁️ Setup (Fast)", "🚀 Render (High Quality)"], {"default": "👁️ Setup (Fast)"}),
                "image": ("IMAGE",),       
                "depth_map": ("IMAGE",),   
                
                # --- DEPTH FORMAT ---
                "depth_format": (["Inverse (Standard/Relative)", "Metric (Depth Anything 3)"], {"default": "Metric (Depth Anything 3)"}),
                "auto_calibrate": ("BOOLEAN", {"default": False, "label_on": "Auto-Scale to Height", "label_off": "Manual Scale"}),
                "camera_height": ("FLOAT", {"default": 1.6, "min": 0.1, "max": 10.0, "step": 0.05, "tooltip": "Reference height of camera from floor (meters)."}),
                "manual_depth_scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 100.0, "step": 0.01}),

                # Camera Pos
                "pos_x": ("FLOAT", {"default": 0.0, "min": -1000.0, "max": 1000.0, "step": 0.1}),
                "pos_y": ("FLOAT", {"default": 0.0, "min": -1000.0, "max": 1000.0, "step": 0.1}),
                "pos_z": ("FLOAT", {"default": 0.0, "min": -1000.0, "max": 1000.0, "step": 0.1}),
                
                "rot_pitch": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "rot_yaw":   ("FLOAT", {"default": 0.0, "min": -720.0, "max": 720.0, "step": 1.0}),
                "rot_roll":  ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                
                "show_character": ("BOOLEAN", {"default": True}),

                # Character
                "char_x": ("FLOAT", {"default": 0.0, "min": -1000.0, "max": 1000.0, "step": 0.1}),
                "char_y": ("FLOAT", {"default": -1.0, "min": -1000.0, "max": 1000.0, "step": 0.1}),
                "char_z": ("FLOAT", {"default": -2.0, "min": -1000.0, "max": 1000.0, "step": 0.1}),
                "char_rot_yaw": ("FLOAT", {"default": 0.0, "min": -720.0, "max": 720.0, "step": 1.0}),
                
                "char_height": ("FLOAT", {"default": 1.75, "min": 0.1, "max": 10.0, "step": 0.05}),
                "char_width": ("FLOAT", {"default": 0.5, "min": 0.1, "max": 5.0, "step": 0.05}),
                
                "head_yaw": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "left_arm_angle": ("FLOAT", {"default": 10.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "right_arm_angle": ("FLOAT", {"default": 10.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                
                "pose_json": ("STRING", {"default": "", "multiline": True}),

                "fov": ("FLOAT", {"default": 90.0, "min": 10.0, "max": 160.0, "step": 1.0}),
                "output_size": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "precision": (["Normal", "High (Super-Sampled)"],),
                "point_density": (["1x", "2x (Recommended)", "4x (Slow)"], {"default": "2x (Recommended)"}),
                "fill_holes": ("INT", {"default": 2, "min": 0, "max": 50, "step": 1}),
                "custom_mesh": (mesh_list, {"default": "None"}),
            },
            "optional": {
                "pointcloud": ("POINTCLOUD",),
                "glb_path": ("STRING", {"forceInput": True}), # NEW: Dust3r GLB Input
            },
            "hidden": { "unique_id": "UNIQUE_ID" }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "MASK", "MASK", "SAMPLING_MAP")
    RETURN_NAMES = ("view_image", "clean_room", "openpose_image", "depth_image", "inpaint_mask", "char_mask", "sampling_map")
    FUNCTION = "process"
    CATEGORY = "image/3d"

    def _convert_to_base64(self, image):
        if image is None: return ""
        try:
            if image.device.type != 'cpu': image = image.cpu()
            H, W, C = image.shape[1:]
            if H > 256:
                image = F.interpolate(image.permute(0,3,1,2), size=(256, 512), mode='bilinear').permute(0,2,3,1)
            i = 255. * image[0].numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            buff = io.BytesIO()
            img.save(buff, format="JPEG", quality=60)
            return "data:image/jpeg;base64," + base64.b64encode(buff.getvalue()).decode("utf-8")
        except Exception: return ""

    def _pointcloud_to_json(self, pointcloud, max_points=50000):
        try:
            if pointcloud is None: return None
            if isinstance(pointcloud, dict):
                points = pointcloud.get('points', None)
                colors = pointcloud.get('colors', None)
                if points is None: return None
                if hasattr(points, 'cpu'): points = points.cpu().numpy()
                if colors is not None and hasattr(colors, 'cpu'): colors = colors.cpu().numpy()
            elif hasattr(pointcloud, 'points'):
                points = pointcloud.points
                colors = getattr(pointcloud, 'colors', None)
                if hasattr(points, 'cpu'): points = points.cpu().numpy()
                if colors is not None and hasattr(colors, 'cpu'): colors = colors.cpu().numpy()
            else: return None
            
            num_points = len(points)
            if num_points > max_points:
                indices = np.random.choice(num_points, max_points, replace=False)
                points = points[indices]
                if colors is not None: colors = colors[indices]
            
            pc_data = { "positions": points.flatten().tolist(), "count": len(points) }
            if colors is not None:
                if colors.max() > 1.0: colors = colors / 255.0
                pc_data["colors"] = colors.flatten().tolist()
            return json.dumps(pc_data)
        except Exception as e:
            print(f"[Qwen6DOF] Error converting pointcloud: {e}")
            return None

    def safe_float(self, v):
        if hasattr(v, 'detach'):
            v = v.detach().cpu()
            if v.numel() > 1: return float(v.flatten()[0].item())
            return float(v.item())
        if isinstance(v, (list, tuple)): return self.safe_float(v[0]) if len(v) > 0 else 0.0
        try: return float(v)
        except: return 0.0

    def load_obj_vertices(self, filename, device):
        node_path = os.path.dirname(os.path.realpath(__file__))
        path = os.path.join(node_path, "models", filename)
        vertices = []
        try:
            if not os.path.exists(path): return None
            with open(path, 'r') as f:
                for line in f:
                    if line.startswith('v '):
                        parts = line.split()
                        vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])
            if not vertices: return None
            v_tensor = torch.tensor(vertices, device=device, dtype=torch.float32)
            v_min = v_tensor.min(dim=0)[0]; v_max = v_tensor.max(dim=0)[0]
            v_center = (v_min + v_max) / 2; v_scale = (v_max - v_min).max()
            if v_scale < 1e-5: v_scale = 1.0
            return (v_tensor - v_center) / v_scale
        except Exception: return None

    def load_obj_content(self, filename):
        if not filename or filename == "None": return None
        node_path = os.path.dirname(os.path.realpath(__file__))
        path = os.path.join(node_path, "models", filename)
        try:
            if not os.path.exists(path): return None
            with open(path, 'r') as f: return f.read()
        except Exception: return None

    def get_rotation_matrix(self, pitch, yaw, roll, device):
        p = torch.tensor(pitch * math.pi / 180.0, device=device)
        y = torch.tensor(yaw * math.pi / 180.0, device=device) 
        r = torch.tensor(roll * math.pi / 180.0, device=device)
        Rx = torch.tensor([[1, 0, 0], [0, torch.cos(p), -torch.sin(p)], [0, torch.sin(p), torch.cos(p)]], device=device)
        Ry = torch.tensor([[torch.cos(y), 0, torch.sin(y)], [0, 1, 0], [-torch.sin(y), 0, torch.cos(y)]], device=device)
        Rz = torch.tensor([[torch.cos(r), -torch.sin(r), 0], [torch.sin(r), torch.cos(r), 0], [0, 0, 1]], device=device)
        return torch.matmul(Rz, torch.matmul(Rx, Ry)).unsqueeze(0)

    def process(self, mode, image, depth_map, depth_format, auto_calibrate, camera_height, manual_depth_scale,
                pos_x, pos_y, pos_z, rot_pitch, rot_yaw, rot_roll, 
                show_character, char_x, char_y, char_z, char_rot_yaw, char_height, char_width,
                head_yaw, left_arm_angle, right_arm_angle, pose_json,
                fov, output_size, precision, point_density, fill_holes, custom_mesh, 
                pointcloud=None, glb_path=None, unique_id=None):
        
        # --- 1. DEPTH STANDARDIZATION ---
        B, H_d, W_d, C_d = depth_map.shape
        if depth_format == "Metric (Depth Anything 3)":
            linear_depth = depth_map.clone()
        else:
            linear_depth = 1.0 / (depth_map + 0.01)

        # --- 2. SCALE CALIBRATION ---
        if auto_calibrate:
            floor_region = linear_depth[:, int(H_d*0.95):, int(W_d*0.4):int(W_d*0.6), :].mean()
            floor_dist_est = self.safe_float(floor_region)
            if floor_dist_est < 0.1: floor_dist_est = 1.0 
            final_scale_factor = self.safe_float(camera_height) / floor_dist_est
        else:
            final_scale_factor = self.safe_float(manual_depth_scale)
            
        true_depth_map = linear_depth * final_scale_factor

        # --- 3. VIEWER PREVIEW ---
        depth_min = true_depth_map.min().item()
        depth_max = true_depth_map.max().item()
        vis_depth_map = (true_depth_map - depth_min) / (depth_max - depth_min + 1e-6)
        viewer_scale_param = depth_max - depth_min
        
        rgb_preview = self._convert_to_base64(image) 
        depth_preview = self._convert_to_base64(vis_depth_map)
        
        # --- POINTCLOUD/OBJ/GLB LOADING ---
        pointcloud_json = None
        if pointcloud is not None:
            pointcloud_json = self._pointcloud_to_json(pointcloud)
        
        obj_content = self.load_obj_content(custom_mesh)
        
        # NEW: Handle GLB Data Loading (Fixed for robustness)
        glb_content = None
        if glb_path:
            # Handle if connection passed a list (batch) instead of single string
            if isinstance(glb_path, (list, tuple)):
                safe_path = glb_path[0]
            else:
                safe_path = glb_path
            
            safe_path = str(safe_path) # Force string conversion
            
            if os.path.exists(safe_path):
                print(f"[Qwen6DOF] Loading GLB from: {safe_path}")
                try:
                    with open(safe_path, "rb") as f:
                        glb_bytes = f.read()
                        glb_content = base64.b64encode(glb_bytes).decode("utf-8")
                        print(f"[Qwen6DOF] GLB Loaded. Size: {len(glb_content)} chars")
                except Exception as e:
                    print(f"[Qwen6DOF] Failed to read GLB file: {e}")
            else:
                 print(f"[Qwen6DOF] GLB Path does not exist: {safe_path}")

        # --- SYNC DATA ---
        _px = self.safe_float(pos_x); _py = self.safe_float(pos_y); _pz = self.safe_float(pos_z)
        _rp = -self.safe_float(rot_pitch); _ry = -self.safe_float(rot_yaw); _rr = self.safe_float(rot_roll)
        _cx = self.safe_float(char_x); _cy = self.safe_float(char_y); _cz = self.safe_float(char_z)
        _cyaw = self.safe_float(char_rot_yaw); _ch = self.safe_float(char_height); _cw = self.safe_float(char_width)
        _hy = self.safe_float(head_yaw); _la = self.safe_float(left_arm_angle); _ra = self.safe_float(right_arm_angle)
        _fov = self.safe_float(fov)

        manual_pose = None
        if pose_json and isinstance(pose_json, str) and len(pose_json) > 10:
            try: manual_pose = json.loads(pose_json)
            except: pass

        sync_data = {
            "x": _px, "y": _py, "z": _pz, 
            "yaw": self.safe_float(rot_yaw), "pitch": self.safe_float(rot_pitch), "roll": _rr, 
            "char_x": _cx, "char_y": _cy, "char_z": _cz, "char_yaw": _cyaw,
            "char_visible": show_character, 
            "depth_scale": viewer_scale_param,
            "char_height": _ch, "char_width": _cw,
            "head_yaw": _hy, "arm_l": _la, "arm_r": _ra
        }

        # --- SETUP MODE (FAST) ---
        if mode == "👁️ Setup (Fast)":
            empty = torch.zeros((1, output_size, output_size), dtype=torch.float32, device=image.device)
            empty_map = torch.zeros((1, output_size, output_size, 1), dtype=torch.float32, device=image.device)
            placeholder = F.interpolate(image.permute(0,3,1,2), size=(output_size, output_size)).permute(0,2,3,1)
            
            ui_data = { 
                "rgb_preview": [rgb_preview], 
                "depth_preview": [depth_preview], 
                "sync_state": [sync_data], 
                "depth_scale": [viewer_scale_param],
                "depth_min": [depth_min]
            }
            if obj_content: ui_data["obj_data"] = [obj_content]
            if pointcloud_json: ui_data["pointcloud_data"] = [pointcloud_json]
            if glb_content: ui_data["glb_data"] = [glb_content] # NEW: Send GLB to Viewer
            
            return {
                "ui": ui_data,
                "result": (placeholder, placeholder, placeholder, placeholder, empty, empty, { "map": empty_map, "orig_shape": (512, 1024), "scale_factor": 1 })
            }

        # --- RENDER MODE (HIGH QUALITY) ---
        # (This section is preserved from your original node)
        device = image.device
        scale_factor = {"1x": 1, "2x (Recommended)": 2, "4x (Slow)": 4}.get(point_density, 1)
        if scale_factor > 1:
            image = F.interpolate(image.permute(0, 3, 1, 2), scale_factor=scale_factor, mode='bilinear').permute(0, 2, 3, 1)
            true_depth_map = F.interpolate(true_depth_map.permute(0, 3, 1, 2), scale_factor=scale_factor, mode='bilinear').permute(0, 2, 3, 1)
        
        B, H, W, C = image.shape
        render_size = output_size * 2 if precision == "High (Super-Sampled)" else output_size
        
        if true_depth_map.shape[1] != H or true_depth_map.shape[2] != W:
            true_depth_map = F.interpolate(true_depth_map.permute(0, 3, 1, 2), size=(H, W), mode='bilinear').permute(0, 2, 3, 1)

        depth_tensor = true_depth_map.mean(dim=-1, keepdim=True) 
        theta = torch.linspace(-np.pi, np.pi, W, device=device).unsqueeze(0).repeat(H, 1)
        phi = torch.linspace(np.pi/2, -np.pi/2, H, device=device).unsqueeze(1).repeat(1, W)
        
        unit_vectors = torch.stack((
            torch.sin(theta)*torch.cos(phi),
            torch.sin(phi),
            -torch.cos(theta)*torch.cos(phi)
        ), dim=-1).reshape(-1, 3).expand(B, -1, -1)
        
        points_world = unit_vectors * (depth_tensor.reshape(B, -1, 1) + 0.001)
        camera_pos = torch.tensor([_px, _py, -_pz], device=device).reshape(1, 1, 3)
        R = self.get_rotation_matrix(_rp, _ry, _rr, device)
        f = 1.0 / torch.tan(torch.tensor(_fov * np.pi / 360.0, device=device))
        
        def project_points(pts_world):
            pts_cam = pts_world - camera_pos
            pts_rot = torch.matmul(pts_cam, R.transpose(1, 2))
            X, Y, Z = pts_rot[..., 0], pts_rot[..., 1], -pts_rot[..., 2]
            valid = (Z > 0.1) & (Z < 1000.0) 
            u = f * X / (Z + 1e-5)
            v = f * Y / (Z + 1e-5)
            u_px = ((u + 1) * 0.5 * (render_size - 1)).long()
            v_px = ((1 - v) * 0.5 * (render_size - 1)).long()
            return u_px, v_px, Z, valid

        u_px, v_px, Z, valid_mask = project_points(points_world)
        source_indices = torch.arange(H * W, device=device, dtype=torch.long).expand(B, -1)
        
        out_batch, mask_batch, map_batch = [], [], []
        
        for b in range(B):
            mask_b = valid_mask[b]
            u_b, v_b, z_b = u_px[b][mask_b], v_px[b][mask_b], Z[b][mask_b]
            rgb_b = image.reshape(B, -1, 3)[b][mask_b]
            idx_b = source_indices[b][mask_b]
            screen_mask = (u_b >= 0) & (u_b < render_size) & (v_b >= 0) & (v_b < render_size)
            u_fin, v_fin = u_b[screen_mask], v_b[screen_mask]
            z_fin, rgb_fin, idx_fin = z_b[screen_mask], rgb_b[screen_mask], idx_b[screen_mask]
            
            sorted_idx = torch.argsort(z_fin, descending=True)
            lin_idx = v_fin[sorted_idx] * render_size + u_fin[sorted_idx]
            canvas = torch.zeros((render_size * render_size, 3), device=device)
            canvas[lin_idx] = rgb_fin[sorted_idx]
            alpha = torch.zeros((render_size * render_size, 1), device=device)
            alpha[lin_idx] = 1.0
            map_c = torch.full((render_size * render_size, 1), -1, device=device, dtype=torch.long)
            map_c[lin_idx] = idx_fin[sorted_idx].unsqueeze(-1)
            out_batch.append(canvas.reshape(render_size, render_size, 3))
            mask_batch.append(1.0 - alpha.reshape(render_size, render_size)) 
            map_batch.append(map_c.reshape(render_size, render_size, 1))

        # --- CHARACTER RENDER ---
        char_mask_batch, char_color_batch, openpose_batch, depth_batch = [], [], [], []
        
        if show_character:
            char_pts_local = None
            if custom_mesh and custom_mesh != "None":
                mesh_verts = self.load_obj_vertices(custom_mesh, device)
                if mesh_verts is not None:
                    mx = mesh_verts[:, 0] * _cw * 2.0 
                    my = (mesh_verts[:, 1] + 0.5) * _ch 
                    mz = mesh_verts[:, 2] * _cw * 2.0 
                    char_pts_local = torch.stack([mx, my, mz], dim=1)

            if char_pts_local is None:
                def get_cyl(h_start, h_end, radius):
                    h_v = torch.linspace(h_start, h_end, 240, device=device); a_v = torch.linspace(0, 2*np.pi, 160, device=device)
                    hg, ag = torch.meshgrid(h_v, a_v, indexing='ij')
                    return torch.stack([radius * torch.cos(ag).flatten(), hg.flatten(), radius * torch.sin(ag).flatten()], dim=1)
                pts_body = []
                pts_body.append(get_cyl(_ch*0.48, _ch*0.82, _cw*0.25))
                pts_body.append(get_cyl(0, _ch*0.48, _cw*0.12) + torch.tensor([-_cw*0.12,0,0], device=device))
                pts_body.append(get_cyl(0, _ch*0.48, _cw*0.12) + torch.tensor([_cw*0.12,0,0], device=device))
                pts_body.append(get_cyl(_ch*0.75, _ch*0.95, _cw*0.2)) 
                char_pts_local = torch.cat(pts_body, dim=0)

            cy_rad = -_cyaw * np.pi / 180.0; cos_y, sin_y = np.cos(cy_rad), np.sin(cy_rad)
            x_rot = char_pts_local[:, 0] * cos_y - char_pts_local[:, 2] * sin_y
            z_rot = char_pts_local[:, 0] * sin_y + char_pts_local[:, 2] * cos_y
            y_rot = char_pts_local[:, 1]
            char_pts_rotated = torch.stack([x_rot, y_rot, z_rot], dim=1)
            char_pts_world = char_pts_rotated + torch.tensor([_cx, _cy, _cz], device=device)
            char_u, char_v, char_z, char_valid = project_points(char_pts_world.unsqueeze(0))
            
            c_u, c_v = char_u[0][char_valid[0]], char_v[0][char_valid[0]]
            c_z = char_z[0][char_valid[0]] 
            c_screen = (c_u >= 0) & (c_u < render_size) & (c_v >= 0) & (c_v < render_size)
            u_fin, v_fin = c_u[c_screen], c_v[c_screen]; z_fin = c_z[c_screen]

            if z_fin.numel() > 0:
                z_min, z_max = z_fin.min(), z_fin.max()
                z_norm = (z_fin - z_min) / (z_max - z_min + 1e-5) 
                brightness = 1.0 - z_norm 
                color_vals = torch.stack([torch.zeros_like(brightness), brightness, brightness], dim=1)
                depth_vals = torch.stack([brightness, brightness, brightness], dim=1)
            else:
                color_vals = torch.zeros((0, 3), device=device)
                depth_vals = torch.zeros((0, 3), device=device)

            char_canvas = torch.zeros((render_size, render_size), device=device)
            char_color_canvas = torch.zeros((render_size, render_size, 3), device=device)
            depth_canvas = torch.zeros((render_size, render_size, 3), device=device)
            
            char_sort = torch.argsort(z_fin, descending=True)
            u_s, v_s, c_s, d_s = u_fin[char_sort], v_fin[char_sort], color_vals[char_sort], depth_vals[char_sort]
            
            char_canvas[v_s, u_s] = 1.0
            lin_idx_c = v_s * render_size + u_s
            char_color_canvas.view(-1, 3)[lin_idx_c] = c_s
            depth_canvas.view(-1, 3)[lin_idx_c] = d_s
            
            mask_t = F.max_pool2d(char_canvas.unsqueeze(0).unsqueeze(0), kernel_size=7, stride=1, padding=3)
            char_mask_batch.append(mask_t.squeeze())
            char_color_batch.append(char_color_canvas)
            depth_filled = F.max_pool2d(depth_canvas.permute(2,0,1).unsqueeze(0), kernel_size=5, stride=1, padding=2)
            depth_batch.append(depth_filled.squeeze(0).permute(1,2,0))

            # --- OPENPOSE GENERATION ---
            kp_3d_points = []
            if manual_pose and "joints" in manual_pose:
                for j in manual_pose["joints"]:
                    kp_3d_points.append([self.safe_float(j["x"]), self.safe_float(j["y"]), self.safe_float(j["z"])])
            else:
                y_neck = _ch * 0.82; y_hip = _ch * 0.48; y_kne = y_hip * 0.5; y_ank = 0.05
                y_nose = _ch * 0.92; y_eye = _ch * 0.95; y_ear = _ch * 0.93
                shoulder_w = _cw * 0.35; hip_w = _cw * 0.12; arm_len = _ch * 0.35
                
                kp_3d = [None]*18
                kp_3d[1] = [0.0, y_neck, 0.0]; kp_3d[8] = [hip_w, y_hip, 0.0]; kp_3d[11] = [-hip_w, y_hip, 0.0]
                kp_3d[9] = [hip_w, y_kne, 0.0]; kp_3d[12] = [-hip_w, y_kne, 0.0]; kp_3d[10] = [hip_w, y_ank, 0.0]; kp_3d[13] = [-hip_w, y_ank, 0.0]
                
                h_rad = _hy * math.pi / 180.0; hc, hs = math.cos(h_rad), math.sin(h_rad)
                def rot_h(x, z): return [x*hc + z*hs, 0.0, -x*hs + z*hc]
                no = rot_h(0.0, _cw * 0.15); kp_3d[0] = [no[0], y_nose, no[2]]
                er = rot_h(_cw*0.06, _cw*0.12); kp_3d[14] = [er[0], y_eye, er[2]]
                el = rot_h(-_cw*0.06, _cw*0.12); kp_3d[15] = [el[0], y_eye, el[2]]
                rr = rot_h(_cw*0.14, 0.0); kp_3d[16] = [rr[0], y_ear, rr[2]]
                lr = rot_h(-_cw*0.14, 0.0); kp_3d[17] = [lr[0], y_ear, lr[2]]
                
                kp_3d[2] = [shoulder_w, y_neck, 0.0]; kp_3d[5] = [-shoulder_w, y_neck, 0.0]
                def get_arm(side, ang):
                    rad = ang * math.pi / 180.0 * side; c, s = math.cos(rad), math.sin(rad)
                    wx, wy = -arm_len*s, -arm_len*c
                    return [wx*0.5, wy*0.5], [wx, wy]
                el_r, wr_r = get_arm(-1, _ra); kp_3d[3] = [shoulder_w + el_r[0], y_neck + el_r[1], 0.0]; kp_3d[4] = [shoulder_w + wr_r[0], y_neck + wr_r[1], 0.0]
                el_l, wr_l = get_arm(1, _la); kp_3d[6] = [-shoulder_w + el_l[0], y_neck + el_l[1], 0.0]; kp_3d[7] = [-shoulder_w + wr_l[0], y_neck + wr_l[1], 0.0]
                
                cy_rad = _cyaw * math.pi / 180.0; cos_y, sin_y = math.cos(cy_rad), math.sin(cy_rad)
                for p in kp_3d:
                    rx = p[0] * cos_y - p[2] * sin_y; rz = p[0] * sin_y + p[2] * cos_y
                    kp_3d_points.append([rx + _cx, p[1] + _cy, rz + _cz])

            kp_tensor = torch.tensor(kp_3d_points, device=device, dtype=torch.float32)
            kp_u, kp_v, kp_z, kp_valid = project_points(kp_tensor.unsqueeze(0))
            u_coords = kp_u[0].cpu().numpy(); v_coords = kp_v[0].cpu().numpy(); valid = kp_valid[0].cpu().numpy()
            
            canvas_pil = Image.new("RGB", (render_size, render_size), (0,0,0))
            draw = ImageDraw.Draw(canvas_pil)
            limbs = [(1,2), (1,5), (2,3), (3,4), (5,6), (6,7), (1,8), (8,9), (9,10), (1,11), (11,12), (12,13), (1,0), (0,14), (14,16), (0,15), (15,17)]
            colors = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85)]
            for i, (start, end) in enumerate(limbs):
                if valid[start] and valid[end]:
                    x1, y1 = u_coords[start], v_coords[start]; x2, y2 = u_coords[end], v_coords[end]
                    if 0<=x1<render_size and 0<=y1<render_size and 0<=x2<render_size and 0<=y2<render_size:
                        draw.line([(x1, y1), (x2, y2)], fill=colors[i % len(colors)], width=int(render_size/100))
            for i in range(18):
                if valid[i]:
                    x, y = u_coords[i], v_coords[i]
                    if 0<=x<render_size and 0<=y<render_size:
                        r = int(render_size/120); c = colors[i % len(colors)]
                        draw.ellipse([(x-r, y-r), (x+r, y+r)], fill=c)
            openpose_batch.append(torch.from_numpy(np.array(canvas_pil)).float() / 255.0)

        else:
            char_mask_batch.append(torch.zeros((render_size, render_size), device=device))
            char_color_batch.append(torch.zeros((render_size, render_size, 3), device=device))
            openpose_batch.append(torch.zeros((render_size, render_size, 3), device=device))
            depth_batch.append(torch.zeros((render_size, render_size, 3), device=device))

        img_t = torch.stack(out_batch).permute(0, 3, 1, 2)
        map_t = torch.stack(map_batch).permute(0, 3, 1, 2).float() 
        mask_t = torch.stack(mask_batch).unsqueeze(1)
        char_mask_final = torch.stack(char_mask_batch).unsqueeze(1)
        char_color_t = torch.stack(char_color_batch).permute(0, 3, 1, 2) 
        pose_t = torch.stack(openpose_batch)
        depth_t = torch.stack(depth_batch).permute(0, 3, 1, 2)

        for _ in range(fill_holes):
            dil_img = F.max_pool2d(img_t, 5, 1, 2)
            dil_map = F.max_pool2d(map_t, 3, 1, 1)
            fill = mask_t * F.max_pool2d(1.0 - mask_t, 3, 1, 1)
            img_t = img_t * (1.0 - fill) + dil_img * fill
            map_t = map_t * (1.0 - fill) + dil_map * fill
            mask_t = mask_t * (1.0 - fill)

        clean_room_t = img_t.clone()

        if show_character:
            img_t = img_t * (1.0 - char_mask_final) + char_color_t * char_mask_final

        if precision == "High (Super-Sampled)":
            img_t = F.interpolate(img_t, size=(output_size, output_size), mode='bilinear')
            clean_room_t = F.interpolate(clean_room_t, size=(output_size, output_size), mode='bilinear')
            pose_t = F.interpolate(pose_t.permute(0,3,1,2), size=(output_size, output_size), mode='nearest').permute(0,2,3,1)
            depth_t = F.interpolate(depth_t, size=(output_size, output_size), mode='bilinear')
            mask_t = F.interpolate(mask_t, size=(output_size, output_size), mode='nearest')
            map_t = F.interpolate(map_t, size=(output_size, output_size), mode='nearest')
            char_mask_final = F.interpolate(char_mask_final, size=(output_size, output_size), mode='nearest')
            
        final_img = img_t.permute(0, 2, 3, 1) 
        final_clean = clean_room_t.permute(0, 2, 3, 1)
        final_map = map_t.permute(0, 2, 3, 1).long()
        final_mask = mask_t.squeeze(1)
        final_char_mask = char_mask_final.squeeze(1)
        final_pose = pose_t 
        final_depth = depth_t.permute(0, 2, 3, 1)

        meta = { "map": final_map, "orig_shape": (H // scale_factor, W // scale_factor), "scale_factor": scale_factor }
        
        ui_data = { 
            "rgb_preview": [rgb_preview], 
            "depth_preview": [depth_preview], 
            "sync_state": [sync_data], 
            "depth_scale": [viewer_scale_param],
            "depth_min": [depth_min]
        }
        if obj_content: ui_data["obj_data"] = [obj_content]
        if pointcloud_json: ui_data["pointcloud_data"] = [pointcloud_json]
        if glb_content: ui_data["glb_data"] = [glb_content] # NEW
        
        return {
            "ui": ui_data,
            "result": (final_img, final_clean, final_pose, final_depth, final_mask, final_char_mask, meta)
        }

class Qwen6DOFInverse:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "original_panorama": ("IMAGE",),
                "edited_view": ("IMAGE",),
                "sampling_map": ("SAMPLING_MAP",),
            }
        }
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("merged_panorama", "change_mask")
    FUNCTION = "restore"
    CATEGORY = "image/3d"

    def restore(self, original_panorama, edited_view, sampling_map):
        device = original_panorama.device
        map_tensor = sampling_map["map"]
        map_h, map_w = map_tensor.shape[1], map_tensor.shape[2]
        if edited_view.shape[1] != map_h or edited_view.shape[2] != map_w:
            edited_view = F.interpolate(edited_view.permute(0, 3, 1, 2), size=(map_h, map_w), mode='bilinear').permute(0, 2, 3, 1)

        orig_H, orig_W = sampling_map["orig_shape"]
        scale_factor = sampling_map["scale_factor"]
        
        if scale_factor > 1:
            working_pano = F.interpolate(original_panorama.permute(0, 3, 1, 2), scale_factor=scale_factor, mode='bilinear').permute(0, 2, 3, 1)
        else:
            working_pano = original_panorama.clone()
            
        B, H, W, C = working_pano.shape
        change_mask = torch.zeros((B, H, W), device=device, dtype=torch.float32)
        
        for b in range(B):
            view_flat = edited_view[b].reshape(-1, 3) 
            idx_flat = map_tensor[b].reshape(-1)      
            valid_mask = idx_flat != -1
            valid_indices = idx_flat[valid_mask].clamp(0, H*W-1)
            working_pano[b].reshape(-1, 3)[valid_indices] = view_flat[valid_mask]
            change_mask[b].reshape(-1)[valid_indices] = 1.0 
            
        if scale_factor > 1:
            final_pano = F.interpolate(working_pano.permute(0, 3, 1, 2), size=(orig_H, orig_W), mode='bilinear').permute(0, 2, 3, 1)
            final_mask = F.interpolate(change_mask.unsqueeze(1), size=(orig_H, orig_W), mode='bilinear').squeeze(1)
        else:
            final_pano, final_mask = working_pano, change_mask
            
        return (final_pano, final_mask)

NODE_CLASS_MAPPINGS = { "SixDOFViewer": Qwen6DOFCamera, "SixDOFInverse": Qwen6DOFInverse }
NODE_DISPLAY_NAME_MAPPINGS = { "SixDOFViewer": "6DOF Viewer", "SixDOFInverse": "6DOF Inverse" }