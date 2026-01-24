import { app } from "../../../scripts/app.js";
import { VIEWER_6DOF_HTML } from "./viewer_template.js";

app.registerExtension({
    name: "Comfy.Qwen6DOFCamera",
    
    async getCustomWidgets(app) {
        return {
            Qwen6DOFCamera: (node, inputName, inputData, app) => {
                const getExtraMenuOptions = node.getExtraMenuOptions;
                node.getExtraMenuOptions = function(_, options) {
                    if (getExtraMenuOptions) getExtraMenuOptions.apply(this, arguments);
                    options.push({
                        content: "🖥️ Fullscreen Viewer",
                        callback: () => {
                            const widget = node.widgets.find(w => w.name === "preview_widget");
                            if (widget && widget.element) {
                                const iframe = widget.element.querySelector('iframe');
                                if (iframe) {
                                    if (iframe.requestFullscreen) iframe.requestFullscreen();
                                    else if (iframe.webkitRequestFullscreen) iframe.webkitRequestFullscreen();
                                }
                            }
                        }
                    });
                }
            }
        }
    },

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "Qwen6DOFCamera") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
                const node = this;

                const widgetName = "preview_widget";
                let viewerWidget = node.widgets ? node.widgets.find(w => w.name === widgetName) : null;
                
                if (!viewerWidget) {
                    const div = document.createElement("div");
                    Object.assign(div.style, { width: "100%", height: "400px", background: "#000" });
                    
                    const iframe = document.createElement("iframe");
                    Object.assign(iframe.style, { width: "100%", height: "100%", border: "none" });
                    iframe.srcdoc = VIEWER_6DOF_HTML;
                    div.appendChild(iframe);

                    viewerWidget = node.addDOMWidget(widgetName, "HTML", div, {
                        serialize: false,
                        hideOnZoom: false
                    });
                }
                
                viewerWidget.computeSize = () => [400, 400];
                this.setSize([420, 750]); 

                let isUpdatingFromViewer = false; 

                const sendSync = () => {
                    if (isUpdatingFromViewer) return;

                    const iframe = viewerWidget.element.querySelector('iframe');
                    if (!iframe || !iframe.contentWindow) return;

                    const getVal = (n) => {
                        const w = node.widgets.find(w => w.name === n);
                        return w ? w.value : 0;
                    };

                    iframe.contentWindow.postMessage({
                        type: 'SYNC',
                        x: getVal('pos_x'), y: getVal('pos_y'), z: getVal('pos_z'),
                        yaw: getVal('rot_yaw'), pitch: getVal('rot_pitch'), roll: getVal('rot_roll'),
                        
                        char_x: getVal('char_x'), char_y: getVal('char_y'), char_z: getVal('char_z'),
                        char_yaw: getVal('char_rot_yaw'),
                        char_height: getVal('char_height'), char_width: getVal('char_width'),

                        char_visible: getVal('show_character'),
                    }, '*');
                };

                const widgetsToWatch = [
                    'pos_x','pos_y','pos_z','rot_yaw','rot_pitch','rot_roll',
                    'char_x','char_y','char_z','char_rot_yaw',
                    'show_character',
                    'char_height', 'char_width'
                ];
                
                setTimeout(() => {
                    if (node.widgets) {
                        for (const w of node.widgets) {
                            if (widgetsToWatch.includes(w.name)) {
                                const originalCallback = w.callback;
                                w.callback = function(value) {
                                    sendSync(); 
                                    if (originalCallback) originalCallback.apply(this, arguments);
                                };
                            }
                        }
                    }
                }, 100);

                window.addEventListener('message', (e) => {
                    const iframe = viewerWidget.element.querySelector('iframe');
                    if (!iframe || e.source !== iframe.contentWindow) return;

                    if (e.data.type === 'VIEWER_READY') {
                        sendSync();
                    } 
                    else if (e.data.type === '6DOF_UPDATE') {
                        isUpdatingFromViewer = true; 
                        const d = e.data;
                        let changed = false;

                        const setVal = (n, v) => {
                            if (v === undefined) return; 
                            
                            const w = node.widgets.find(x => x.name === n);
                            if (w && w.value !== v) {
                                w.value = v; 
                                if (w.callback) w.callback(w.value); 
                                changed = true;
                            }
                        };

                        setVal('pos_x', d.x); setVal('pos_y', d.y); setVal('pos_z', d.z);
                        setVal('rot_yaw', d.yaw); setVal('rot_pitch', d.pitch); setVal('rot_roll', d.roll);
                        
                        setVal('char_x', d.char_x); setVal('char_y', d.char_y); setVal('char_z', d.char_z);
                        setVal('char_rot_yaw', d.char_rot_yaw);

                        setVal('show_character', d.char_visible); 

                        if (d.pose_json) {
                            const w = node.widgets.find(x => x.name === "pose_json");
                            if (w && w.value !== d.pose_json) {
                                w.value = d.pose_json;
                                if (w.callback) w.callback(w.value);
                                changed = true;
                            }
                        }

                        if (changed) {
                            app.graph.setDirtyCanvas(true, true); 
                        }
                        
                        setTimeout(() => isUpdatingFromViewer = false, 50);
                    }
                });

                return r;
            };

            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function(message) {
                if (onExecuted) onExecuted.apply(this, arguments);
                
                const widget = this.widgets ? this.widgets.find(w => w.name === "preview_widget") : null;
                if (!widget) return;
                
                const iframe = widget.element.querySelector('iframe');
                if (!iframe || !iframe.contentWindow) return;
                
                // Send room preview data (RGB, Depth, Pointcloud)
                if (message?.rgb_preview) {
                    iframe.contentWindow.postMessage({
                        type: 'UPDATE_ROOM',
                        rgb: message.rgb_preview[0],
                        depth: message.depth_preview[0],
                        depth_scale: message.depth_scale ? message.depth_scale[0] : 1.0,
                        depth_min: message.depth_min ? message.depth_min[0] : 0.0,
                        pointcloud_data: message.pointcloud_data ? message.pointcloud_data[0] : null
                    }, '*');
                }
                
                // Send OBJ data if available
                if (message?.obj_data) {
                    const getVal = (n) => {
                        const w = this.widgets.find(w => w.name === n);
                        return w ? w.value : 0;
                    };
                    
                    iframe.contentWindow.postMessage({
                        type: 'UPDATE_OBJ',
                        obj_data: message.obj_data[0],
                        char_height: getVal('char_height'),
                        char_width: getVal('char_width')
                    }, '*');
                }

                // NEW: Send GLB Data
                if (message?.glb_data) {
                    iframe.contentWindow.postMessage({
                        type: 'UPDATE_GLB',
                        glb_data: message.glb_data[0]
                    }, '*');
                }
            };
        }
    }
});