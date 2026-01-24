export const VIEWER_6DOF_HTML = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { margin: 0; background: #1a1a1a; overflow: hidden; font-family: sans-serif; user-select: none; }
        #tools { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; z-index: 10; }
        .tool-btn { background: #333; color: #fff; border: 1px solid #555; padding: 8px 16px; cursor: pointer; border-radius: 4px; font-weight: bold; font-size: 12px; }
        .tool-btn:hover { background: #444; }
        .tool-btn.active { background: #007bff; border-color: #0056b3; }
        #reset-btn { background: #6c757d; }
        #full-btn { background: #444; border-color: #777; }
        
        #gizmo-tools { position: absolute; top: 50px; left: 50%; transform: translateX(-50%); display: flex; gap: 5px; z-index: 10; }
        .gizmo-btn { background: #222; color: #aaa; border: 1px solid #444; padding: 6px 12px; cursor: pointer; font-size: 11px; border-radius: 4px; font-weight: bold;}
        .gizmo-btn:hover { background: #333; color: #fff; }
        .gizmo-btn.active { background: #007bff; color: #fff; border-color: #0056b3; }
        
        #help-text { position: absolute; bottom: 10px; left: 10px; color: #888; font-size: 12px; pointer-events: none; }
        #status-text { position: absolute; bottom: 30px; left: 10px; color: #0f0; font-size: 11px; pointer-events: none; font-weight: bold; text-shadow: 1px 1px 2px black;}
        #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); color: white; display:none; pointer-events:none; background:rgba(0,0,0,0.8); padding:10px; border-radius:5px;}
    </style>
</head>
<body>
    <div id="tools">
        <div id="mode-cam" class="tool-btn active">📷 Camera</div>
        <div id="mode-pose" class="tool-btn">🏃 Person</div>
        <div id="toggle-mesh" class="tool-btn">🧊 Mesh</div>
        <div id="reset-btn" class="tool-btn">↺ Reset</div>
        <div id="full-btn" class="tool-btn">⛶ Full</div>
    </div>
    <div id="gizmo-tools">
        <div id="gizmo-t" class="gizmo-btn active">Move (T)</div>
        <div id="gizmo-r" class="gizmo-btn">Rotate (R)</div>
    </div>
    <div id="help-text">Click object to select. Use Move/Rotate (or SPACE) to toggle Gizmo.</div>
    <div id="status-text"></div>
    <div id="loading">Loading GLB...</div>
    <div id="container" style="width:100%; height:100vh;"></div>
    
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>

    <script>
        // ============================================
        // 1. SCENE SETUP
        // ============================================
        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111116);
        
        var grid = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
        scene.add(grid);

        var camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 200);
        camera.position.set(5, 5, 5);
        camera.lookAt(0, 0, 0);
        
        var renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.getElementById('container').appendChild(renderer.domElement);

        var ambLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambLight);
        var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(2, 5, 5);
        scene.add(dirLight);

        function setStatus(msg, isError) {
            var el = document.getElementById('status-text');
            el.innerText = msg;
            el.style.color = isError ? '#ff4444' : '#00ff00';
        }

        // ============================================
        // 2. CONTROLS
        // ============================================
        var orbit = new THREE.OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.1;

        var control = new THREE.TransformControls(camera, renderer.domElement);
        control.setSize(1.0); 
        control.addEventListener('dragging-changed', function(event) {
            orbit.enabled = !event.value;
        });
        scene.add(control);

        // ============================================
        // 3. STATE & OBJECTS
        // ============================================
        var state = {
            cam_x: 0, cam_y: 0, cam_z: 0,
            cam_yaw: 0, cam_pitch: 0, cam_roll: 0,
            char_x: 0, char_y: 0, char_z: 0, char_yaw: 0,
            char_h: 1.75, char_w: 0.5
        };
        var charVisible = true;
        var meshVisible = true;
        var usingDA3PointCloud = false;

        // Camera group
        var camGroup = new THREE.Group();
        camGroup.rotation.order = "YXZ";
        scene.add(camGroup);
        
        var coneGeo = new THREE.ConeGeometry(0.05, 0.15, 8);
        coneGeo.rotateX(Math.PI / 2);
        var camMesh = new THREE.Mesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0xff0055 }));
        camGroup.add(camMesh);
        
        var ringMesh = new THREE.Mesh(
            new THREE.TorusGeometry(0.25, 0.005, 8, 32),
            new THREE.MeshBasicMaterial({ color: 0x00ffff, opacity: 0.6, transparent: true })
        );
        ringMesh.rotation.x = Math.PI / 2;
        camGroup.add(ringMesh);
        
        var frustumCam = new THREE.PerspectiveCamera(60, 1, 0.1, 0.5);
        var camHelper = new THREE.CameraHelper(frustumCam);
        camHelper.material.color.set(0xffaa00);
        scene.add(camHelper);

        // Character group
        var charGroup = new THREE.Group();
        scene.add(charGroup);

        // OBJ/GLB mesh group
        var objMeshGroup = new THREE.Group();
        scene.add(objMeshGroup);
        var currentObjMesh = null;

        function updateVisuals() {
            camGroup.position.set(state.cam_x, state.cam_y, state.cam_z);
            camGroup.rotation.y = state.cam_yaw * Math.PI / 180;
            camGroup.rotation.x = state.cam_pitch * Math.PI / 180;
            camGroup.rotation.z = state.cam_roll * Math.PI / 180;
            
            frustumCam.position.copy(camGroup.position);
            frustumCam.rotation.copy(camGroup.rotation);
            frustumCam.updateMatrixWorld();
            camHelper.update();

            charGroup.position.set(state.char_x, state.char_y, state.char_z);
            charGroup.rotation.y = -state.char_yaw * Math.PI / 180;
            charGroup.visible = charVisible;
            
            objMeshGroup.position.copy(charGroup.position);
            objMeshGroup.rotation.copy(charGroup.rotation);
            objMeshGroup.visible = meshVisible && currentObjMesh !== null;
        }

        // ============================================
        // 4. POINT CLOUD (DA3 or Depth-based)
        // ============================================
        var cloudMesh = null;
        var lastRGBUrl = '';
        
        function loadDA3PointCloud(pcData) {
            if (cloudMesh) { scene.remove(cloudMesh); cloudMesh = null; }
            try {
                var data = JSON.parse(pcData);
                var positions = new Float32Array(data.positions);
                var count = data.count;
                
                var geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                
                if (data.colors) {
                    var colors = new Float32Array(data.colors);
                    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                }
                
                var sizes = new Float32Array(count);
                for (var i = 0; i < count; i++) {
                    var x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
                    var dist = Math.sqrt(x*x + y*y + z*z);
                    sizes[i] = Math.max(0.02, dist * 0.03);
                }
                geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

                var material = new THREE.ShaderMaterial({
                    uniforms: {},
                    vertexShader: \`
                        attribute float size;
                        varying vec3 vColor;
                        void main() {
                            vColor = color;
                            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                            gl_PointSize = size * (300.0 / -mvPosition.z);
                            gl_Position = projectionMatrix * mvPosition;
                        }
                    \`,
                    fragmentShader: \`
                        varying vec3 vColor;
                        void main() {
                            vec2 center = gl_PointCoord - 0.5;
                            float dist = length(center);
                            float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
                            if (alpha < 0.01) discard;
                            gl_FragColor = vec4(vColor, alpha);
                        }
                    \`,
                    transparent: true,
                    vertexColors: true,
                    depthTest: false
                });

                cloudMesh = new THREE.Points(geometry, material);
                cloudMesh.renderOrder = -1;
                scene.add(cloudMesh);
                usingDA3PointCloud = true;
                setStatus("DA3 Point Cloud: " + count + " points");
            } catch (e) {
                console.error("Error loading DA3 point cloud:", e);
                setStatus("Error loading point cloud", true);
            }
        }

        function updateRoom(rgbUrl, depthUrl, scale, depthMin) {
            if (usingDA3PointCloud && cloudMesh) return;
            if (rgbUrl === lastRGBUrl && cloudMesh) return;
            lastRGBUrl = rgbUrl;
            if (cloudMesh) { scene.remove(cloudMesh); cloudMesh = null; }

            var loader = new THREE.TextureLoader();
            Promise.all([
                new Promise(function(r) { loader.load(rgbUrl, r); }),
                new Promise(function(r) { loader.load(depthUrl, r); })
            ]).then(function(textures) {
                var tRGB = textures[0], tD = textures[1];
                var w = 512, h = 256;
                var cRGB = document.createElement('canvas'); cRGB.width = w; cRGB.height = h;
                cRGB.getContext('2d').drawImage(tRGB.image, 0, 0, w, h);
                var dRGB = cRGB.getContext('2d').getImageData(0, 0, w, h).data;
                var cD = document.createElement('canvas'); cD.width = w; cD.height = h;
                cD.getContext('2d').drawImage(tD.image, 0, 0, w, h);
                var dD = cD.getContext('2d').getImageData(0, 0, w, h).data;

                var positions = [], colors = [], sizes = [];
                var step = 1;
                var minDepth = depthMin || 0.5;
                var depthRange = scale || 10.0;

                for (var y = 0; y < h; y += step) {
                    for (var x = 0; x < w; x += step) {
                        var i = (y * w + x) * 4;
                        var d = (dD[i] / 255.0) * depthRange + minDepth;
                        if (d < 0.1 || d > 100) continue;
                        var u = x / (w - 1), v = y / (h - 1);
                        var theta = (u * 2 - 1) * Math.PI, phi = (1 - v * 2) * (Math.PI / 2);
                        var px = Math.sin(theta) * Math.cos(phi) * d, py = Math.sin(phi) * d, pz = -Math.cos(theta) * Math.cos(phi) * d;
                        positions.push(px, py, pz);
                        colors.push(dRGB[i] / 255, dRGB[i + 1] / 255, dRGB[i + 2] / 255);
                        sizes.push(d * 0.05);
                    }
                }
                var geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                geometry.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
                var material = new THREE.ShaderMaterial({
                    uniforms: {},
                    vertexShader: \`attribute float size; varying vec3 vColor; void main() { vColor = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (300.0 / -mvPosition.z); gl_Position = projectionMatrix * mvPosition; }\`,
                    fragmentShader: \`varying vec3 vColor; void main() { vec2 center = gl_PointCoord - 0.5; float dist = length(center); float alpha = 1.0 - smoothstep(0.3, 0.5, dist); if (alpha < 0.01) discard; gl_FragColor = vec4(vColor, alpha); }\`,
                    transparent: true, vertexColors: true, depthTest: false
                });
                cloudMesh = new THREE.Points(geometry, material);
                cloudMesh.renderOrder = -1;
                scene.add(cloudMesh);
                usingDA3PointCloud = false;
                setStatus("Depth-based: " + (positions.length / 3) + " points");
            });
        }

        // ============================================
        // 5. OBJ & GLB LOADERS
        // ============================================
        function loadOBJ(objData, charHeight, charWidth) {
            if (currentObjMesh) { objMeshGroup.remove(currentObjMesh); currentObjMesh = null; }
            if (!objData || objData === 'None') { updateMeshToggleUI(); return; }
            
            var loader = new THREE.OBJLoader();
            var object = loader.parse(objData);
            processImportedMesh(object, charHeight, charWidth);
        }

        // NEW: GLB Loader (Improved)
        function loadGLB(base64Data) {
            if (!THREE.GLTFLoader) {
                setStatus("GLTFLoader missing! Check internet.", true);
                return;
            }
            if (currentObjMesh) { objMeshGroup.remove(currentObjMesh); currentObjMesh = null; }
            document.getElementById('loading').style.display = 'block';

            try {
                var binaryString = window.atob(base64Data);
                var len = binaryString.length;
                var bytes = new Uint8Array(len);
                for (var i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
                
                var loader = new THREE.GLTFLoader();
                // Pass './' as path argument to satisfy parser
                loader.parse(bytes.buffer, './', (gltf) => {
                    var model = gltf.scene;
                    currentObjMesh = model;
                    objMeshGroup.add(model);
                    document.getElementById('loading').style.display = 'none';
                    
                    objMeshGroup.position.set(0,0,0);
                    objMeshGroup.rotation.set(0,0,0);
                    
                    updateMeshToggleUI();
                    setStatus("GLB Scene Loaded");
                }, (err) => {
                    console.error(err);
                    document.getElementById('loading').style.display = 'none';
                    setStatus("Error parsing GLB data", true);
                });
            } catch (e) {
                console.error(e);
                document.getElementById('loading').style.display = 'none';
                setStatus("Error processing GLB base64", true);
            }
        }

        function processImportedMesh(object, charHeight, charWidth) {
            var box = new THREE.Box3().setFromObject(object);
            var center = box.getCenter(new THREE.Vector3());
            var size = box.getSize(new THREE.Vector3());
            var maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim < 0.0001) maxDim = 1;
            
            object.traverse(function(child) {
                if (child.isMesh) {
                    child.geometry.translate(-center.x, -center.y, -center.z);
                    child.geometry.scale(1 / maxDim, 1 / maxDim, 1 / maxDim);
                    child.geometry.scale(charWidth * 2, charHeight, charWidth * 2);
                    child.geometry.translate(0, charHeight / 2, 0);
                    child.material = new THREE.MeshLambertMaterial({
                        color: 0x00cccc, transparent: true, opacity: 0.8, side: THREE.DoubleSide
                    });
                }
            });
            currentObjMesh = object;
            objMeshGroup.add(object);
            updateMeshToggleUI();
            updateVisuals();
        }

        function updateMeshToggleUI() {
            var btn = document.getElementById('toggle-mesh');
            if (currentObjMesh && meshVisible) btn.className = 'tool-btn active';
            else btn.className = 'tool-btn';
        }

        // ============================================
        // 6. SKELETON SYSTEM
        // ============================================
        var joints = [], bones = [];
        var cocoColors = [[255,0,0], [255,85,0], [255,170,0], [255,255,0], [170,255,0], [85,255,0], [0,255,0], [0,255,85], [0,255,170], [0,255,255], [0,170,255], [0,85,255], [0,0,255], [85,0,255], [170,0,255], [255,0,255], [255,0,170], [255,0,85]];
        var connections = [[1,2], [1,5], [2,3], [3,4], [5,6], [6,7], [1,8], [8,9], [9,10], [1,11], [11,12], [12,13], [1,0], [0,14], [14,16], [0,15], [15,17]];

        function getTPose(h, w) {
            var yn = h * 0.82, yh = h * 0.48, yk = yh * 0.5, ya = 0.05;
            var yno = h * 0.92, ye = h * 0.95, year = h * 0.93;
            var sw = w * 0.35, hw = w * 0.12, al = h * 0.35;
            return [
                {x: 0, y: yno, z: 0}, {x: 0, y: yn, z: 0},
                {x: sw, y: yn, z: 0}, {x: sw + al * 0.5, y: yn, z: 0}, {x: sw + al, y: yn, z: 0},
                {x: -sw, y: yn, z: 0}, {x: -sw - al * 0.5, y: yn, z: 0}, {x: -sw - al, y: yn, z: 0},
                {x: hw, y: yh, z: 0}, {x: hw, y: yk, z: 0}, {x: hw, y: ya, z: 0},
                {x: -hw, y: yh, z: 0}, {x: -hw, y: yk, z: 0}, {x: -hw, y: ya, z: 0},
                {x: 0.06, y: ye, z: 0.05}, {x: -0.06, y: ye, z: 0.05},
                {x: 0.1, y: year, z: -0.05}, {x: -0.1, y: year, z: -0.05}
            ];
        }

        function createSkeleton() {
            var geo = new THREE.SphereGeometry(0.06, 16, 16);
            var pose = getTPose(1.75, 0.5);
            for (var i = 0; i < 18; i++) {
                var c = cocoColors[i];
                var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0]/255, c[1]/255, c[2]/255) });
                var mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(pose[i].x, pose[i].y, pose[i].z);
                mesh.userData = { id: i, isJoint: true };
                joints.push(mesh);
                charGroup.add(mesh);
            }
            for (var j = 0; j < connections.length; j++) {
                var s = connections[j][0], e = connections[j][1];
                var c = cocoColors[e];
                var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0]/255, c[1]/255, c[2]/255) });
                var bone = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 8), mat);
                bone.userData = { start: s, end: e };
                bones.push(bone);
                charGroup.add(bone);
            }
            updateBones();
        }

        function rebuildSkeleton(h, w) {
            var pose = getTPose(h, w);
            for (var i = 0; i < 18; i++) { joints[i].position.set(pose[i].x, pose[i].y, pose[i].z); }
            updateBones();
            sendPoseToComfy();
        }

        function updateBones() {
            bones.forEach(function(b) {
                var s = joints[b.userData.start].position;
                var e = joints[b.userData.end].position;
                var dist = s.distanceTo(e);
                b.scale.set(1, dist, 1);
                b.position.copy(s).lerp(e, 0.5);
                b.lookAt(e);
                b.rotateX(Math.PI / 2);
            });
        }

        createSkeleton();

        function solveIK(chain, targetPos) {
            if (!chain || chain.length < 2) return;
            for (var iter = 0; iter < 5; iter++) {
                for (var i = chain.length - 2; i >= 0; i--) {
                    var joint = joints[chain[i]];
                    var end = joints[chain[chain.length - 1]];
                    var rc = new THREE.Vector3().subVectors(end.position, joint.position).normalize();
                    var rt = new THREE.Vector3().subVectors(targetPos, joint.position).normalize();
                    var angle = rc.angleTo(rt);
                    if (angle > 0.5) angle = 0.5;
                    if (angle > 0.001) {
                        var axis = new THREE.Vector3().crossVectors(rc, rt).normalize();
                        var q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
                        for (var k = i + 1; k < chain.length; k++) {
                            var child = joints[chain[k]];
                            var vec = new THREE.Vector3().subVectors(child.position, joint.position);
                            vec.applyQuaternion(q);
                            child.position.addVectors(joint.position, vec);
                        }
                    }
                }
            }
        }

        // ============================================
        // 7. INTERACTION & GIZMO
        // ============================================
        var raycaster = new THREE.Raycaster();
        var mouse = new THREE.Vector2();
        var activeTool = 'camera';

        function setMode(m) {
            activeTool = m;
            control.detach();
            if (m === 'pose') { camGroup.visible = false; camHelper.visible = false; control.attach(charGroup); } 
            else { camGroup.visible = true; camHelper.visible = true; control.attach(camGroup); }
            document.getElementById('mode-cam').className = m === 'camera' ? 'tool-btn active' : 'tool-btn';
            document.getElementById('mode-pose').className = m === 'pose' ? 'tool-btn active' : 'tool-btn';
        }

        window.addEventListener('pointerdown', function(event) {
            if (event.clientY < 80) return;
            var rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            if (activeTool === 'pose') {
                if (!charVisible) return;
                var hits = raycaster.intersectObjects(joints);
                if (hits.length > 0) {
                    var obj = hits[0].object;
                    var id = obj.userData.id;
                    if (event.shiftKey || id === 1) control.attach(charGroup);
                    else control.attach(obj);
                } else control.attach(charGroup);
            } else control.attach(camGroup);
        });

        control.addEventListener('change', function() {
            if (control.object) {
                if (control.object === camGroup) {
                    state.cam_x = camGroup.position.x; state.cam_y = camGroup.position.y; state.cam_z = camGroup.position.z;
                    state.cam_yaw = camGroup.rotation.y * 180 / Math.PI; state.cam_pitch = camGroup.rotation.x * 180 / Math.PI; state.cam_roll = camGroup.rotation.z * 180 / Math.PI;
                    updateVisuals(); sendSync();
                } else if (control.object === charGroup) {
                    state.char_x = charGroup.position.x; state.char_y = charGroup.position.y; state.char_z = charGroup.position.z;
                    state.char_yaw = -charGroup.rotation.y * 180 / Math.PI;
                    sendPoseToComfy();
                } else if (control.object.userData.isJoint) {
                    var j = control.object.userData.id; var pos = control.object.position.clone();
                    if (j === 4) solveIK([2, 3, 4], pos); else if (j === 7) solveIK([5, 6, 7], pos);
                    else if (j === 10) solveIK([8, 9, 10], pos); else if (j === 13) solveIK([11, 12, 13], pos);
                    updateBones(); sendPoseToComfy();
                }
            }
        });

        window.addEventListener('keydown', function(event) {
            switch (event.key) {
                case 't': control.setMode('translate'); updateGizmoUI('t'); break;
                case 'r': control.setMode('rotate'); updateGizmoUI('r'); break;
                case ' ': var newMode = control.getMode() === 'translate' ? 'rotate' : 'translate'; control.setMode(newMode); updateGizmoUI(newMode === 'translate' ? 't' : 'r'); break;
                case 'm': meshVisible = !meshVisible; updateMeshToggleUI(); updateVisuals(); break;
            }
        });

        // ============================================
        // 8. UI BUTTONS
        // ============================================
        var btnReset = document.getElementById('reset-btn');
        var btnFull = document.getElementById('full-btn');
        var btnGizmoT = document.getElementById('gizmo-t');
        var btnGizmoR = document.getElementById('gizmo-r');
        var btnToggleMesh = document.getElementById('toggle-mesh');

        function updateGizmoUI(m) {
            btnGizmoT.className = m === 't' ? 'gizmo-btn active' : 'gizmo-btn';
            btnGizmoR.className = m === 'r' ? 'gizmo-btn active' : 'gizmo-btn';
        }

        document.getElementById('mode-cam').onclick = function() { setMode('camera'); };
        document.getElementById('mode-pose').onclick = function() { setMode('pose'); };
        btnGizmoT.onclick = function() { control.setMode('translate'); updateGizmoUI('t'); };
        btnGizmoR.onclick = function() { control.setMode('rotate'); updateGizmoUI('r'); };
        btnToggleMesh.onclick = function() { meshVisible = !meshVisible; updateMeshToggleUI(); updateVisuals(); };
        
        btnReset.onclick = function() {
            state.cam_x = 0; state.cam_y = 0; state.cam_z = 0;
            state.cam_yaw = 0; state.cam_pitch = 0; state.cam_roll = 0;
            updateVisuals(); rebuildSkeleton(state.char_h, state.char_w);
            camGroup.visible = true; camHelper.visible = true;
            setMode('camera'); sendSync();
        };

        btnFull.onclick = function() {
            if (!document.fullscreenElement) document.body.requestFullscreen();
            else document.exitFullscreen();
        };

        // ============================================
        // 9. COMMUNICATION
        // ============================================
        function sendSync() {
            window.parent.postMessage({
                type: '6DOF_UPDATE',
                x: state.cam_x, y: state.cam_y, z: state.cam_z,
                yaw: state.cam_yaw, pitch: state.cam_pitch, roll: state.cam_roll,
                char_x: state.char_x, char_y: state.char_y, char_z: state.char_z,
                char_rot_yaw: state.char_yaw,
                char_visible: charVisible
            }, '*');
        }

        function sendPoseToComfy() {
            var poseData = { joints: [] };
            for (var i = 0; i < 18; i++) {
                var v = new THREE.Vector3();
                joints[i].getWorldPosition(v);
                poseData.joints.push({ x: v.x, y: v.y, z: v.z });
            }
            window.parent.postMessage({
                type: '6DOF_UPDATE',
                x: state.cam_x, y: state.cam_y, z: state.cam_z,
                yaw: state.cam_yaw, pitch: state.cam_pitch, roll: state.cam_roll,
                char_x: state.char_x, char_y: state.char_y, char_z: state.char_z,
                char_rot_yaw: state.char_yaw,
                char_visible: charVisible,
                pose_json: JSON.stringify(poseData)
            }, '*');
        }

        function animate() { requestAnimationFrame(animate); orbit.update(); renderer.render(scene, camera); }
        animate();

        window.addEventListener('resize', function() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        window.addEventListener('message', function(e) {
            if (e.data.type === 'SYNC') {
                var d = e.data;
                state.cam_x = d.x; state.cam_y = d.y; state.cam_z = d.z;
                state.cam_yaw = d.yaw; state.cam_pitch = d.pitch; state.cam_roll = d.roll;
                state.char_x = d.char_x; state.char_y = d.char_y; state.char_z = d.char_z; state.char_yaw = d.char_yaw;
                if (d.char_visible !== undefined) charVisible = d.char_visible;
                var newH = parseFloat(d.char_height), newW = parseFloat(d.char_width);
                if (Math.abs(newH - state.char_h) > 0.01 || Math.abs(newW - state.char_w) > 0.01) {
                    state.char_h = newH; state.char_w = newW; rebuildSkeleton(newH, newW);
                }
                updateVisuals();
            } else if (e.data.type === 'UPDATE_ROOM') {
                if (e.data.pointcloud_data) loadDA3PointCloud(e.data.pointcloud_data);
                else { usingDA3PointCloud = false; updateRoom(e.data.rgb, e.data.depth, e.data.depth_scale, e.data.depth_min); }
            } else if (e.data.type === 'UPDATE_POINTCLOUD') {
                loadDA3PointCloud(e.data.pointcloud_data);
            } else if (e.data.type === 'UPDATE_OBJ') {
                loadOBJ(e.data.obj_data, e.data.char_height || state.char_h, e.data.char_width || state.char_w);
            } else if (e.data.type === 'UPDATE_GLB') {
                loadGLB(e.data.glb_data);
            }
        });

        window.parent.postMessage({ type: 'VIEWER_READY' }, '*');
    </script>
</body>
</html>
`;