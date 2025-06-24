/**
 * Enhanced STEP File 3D Viewer with Per-Face Mesh Creation
 * Creates separate Three.js meshes for each STEP face using server face mapping
 */

class StepViewer {
    constructor() {
        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        
        // State
        this.loadedMeshes = [];
        this.faceMeshes = []; // Store individual face meshes
        this.faceMapping = new Map(); // Map face IDs to mesh objects
        this.currentMaterial = 'standard';
        this.sceneInitialized = false;
        this.pendingMeshes = null;
        
        // Face selection
        this.faceSelector = null;
        this.selectedFaces = new Set();
        this.currentComponent = 'inlet'; // Track current component: 'inlet' or 'riser'
        this.componentExported = { inlet: false, riser: false }; // Track export status
        
        // DOM elements
        this.elements = {};
        
        // Initialize the viewer
        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        
        console.log('🚀 Enhanced STEP Viewer initialized with per-face mesh support');
        console.log('📡 Ready to receive files from Python server');
    }

    cacheElements() {
        this.elements = {
            uploadPage: document.getElementById('uploadPage'),
            viewportPage: document.getElementById('viewportPage'),
            uploadArea: document.getElementById('uploadArea'),
            fileInput: document.getElementById('fileInput'),
            loading: document.getElementById('loading'),
            progressFill: document.getElementById('progressFill'),
            loadingStatus: document.getElementById('loadingStatus'),
            messageArea: document.getElementById('messageArea'),
            canvas: document.getElementById('canvas')
        };
        
        // Create typing overlay element
        this.createTypingOverlay();
    }

    createTypingOverlay() {
        // Create typing overlay container
        const typingOverlay = document.createElement('div');
        typingOverlay.id = 'typingOverlay';
        typingOverlay.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: #4CAF50;
            font-size: 2.5em;
            font-family: 'Courier New', monospace;
            padding: 20px 40px;
            border-radius: 15px;
            z-index: 9999;
            display: none;
            text-align: center;
            border: 3px solid #4CAF50;
            box-shadow: 0 0 30px rgba(76, 175, 80, 0.5);
            backdrop-filter: blur(5px);
            white-space: nowrap;
        `;
        
        // Create text container with cursor
        const textContainer = document.createElement('div');
        textContainer.style.cssText = `
            display: inline-block;
            position: relative;
        `;
        
        const textElement = document.createElement('span');
        textElement.id = 'typingText';
        textElement.style.color = '#4CAF50';
        
        const cursor = document.createElement('span');
        cursor.id = 'typingCursor';
        cursor.textContent = '|';
        cursor.style.cssText = `
            animation: blink 1s infinite;
            margin-left: 3px;
            color: #4CAF50;
            font-weight: bold;
        `;
        
        // Add blinking cursor animation
        if (!document.getElementById('typing-animation-style')) {
            const style = document.createElement('style');
            style.id = 'typing-animation-style';
            style.textContent = `
                @keyframes blink {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        textContainer.appendChild(textElement);
        textContainer.appendChild(cursor);
        typingOverlay.appendChild(textContainer);
        
        // Always append to body for reliable positioning
        document.body.appendChild(typingOverlay);
        
        this.elements.typingOverlay = typingOverlay;
        this.elements.typingText = textElement;
        this.elements.typingCursor = cursor;
        
        console.log('✅ Typing overlay created and added to DOM (positioned at top)');
    }

    showTypingEffect(text, duration = 30) { // Changed default from 100 to 30
        if (!this.elements.typingOverlay) {
            console.warn('⚠️ Typing overlay not found, creating it now...');
            this.createTypingOverlay();
        }
        
        console.log(`🎬 Starting typing effect: "${text}"`);
        
        this.elements.typingOverlay.style.display = 'block';
        this.elements.typingText.textContent = '';
        
        let charIndex = 0;
        
        const typeChar = () => {
            if (charIndex < text.length) {
                this.elements.typingText.textContent += text[charIndex];
                charIndex++;
                setTimeout(typeChar, duration);
            } else {
                console.log('✅ Typing effect completed');
                // Keep the message visible for 4 seconds, then fade out
                setTimeout(() => {
                    this.hideTypingEffect();
                }, 4000);
            }
        };
        
        // Start typing immediately
        typeChar();
    }

    hideTypingEffect() {
        if (!this.elements.typingOverlay) return;
        
        console.log('🎭 Hiding typing effect...');
        
        // Fade out effect
        this.elements.typingOverlay.style.transition = 'opacity 1s ease-out';
        this.elements.typingOverlay.style.opacity = '0';
        
        setTimeout(() => {
            this.elements.typingOverlay.style.display = 'none';
            this.elements.typingOverlay.style.opacity = '1';
            this.elements.typingOverlay.style.transition = '';
            console.log('✅ Typing effect hidden');
        }, 1000);
    }

    initScene() {
        if (this.sceneInitialized) return;
        
        console.log('🎬 Initializing 3D Scene...');
        
        if (!this.elements.viewportPage.classList.contains('active')) {
            console.log('📄 Viewport not active yet, waiting...');
            return;
        }
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);

        const canvasWidth = this.elements.canvas.clientWidth || 800;
        const canvasHeight = this.elements.canvas.clientHeight || 600;
        
        console.log('📐 Canvas size:', canvasWidth, 'x', canvasHeight);

        this.camera = new THREE.PerspectiveCamera(75, canvasWidth / canvasHeight, 0.1, 10000);
        this.camera.position.set(10, 10, 10);

        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.elements.canvas, 
            antialias: true,
            alpha: true 
        });
        this.renderer.setSize(canvasWidth, canvasHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.setupLighting();
        this.setupSceneHelpers();
        this.setupOrbitControls();
        this.setupFaceSelection();
        this.startRenderLoop();
        
        this.sceneInitialized = true;
        console.log('✅ 3D Scene initialized successfully with face selection');
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 50, 50);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);
    }

    setupSceneHelpers() {
        const gridHelper = new THREE.GridHelper(100, 100, 0x444444, 0x444444);
        this.scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);
    }

    setupFaceSelection() {
        // Setup raycaster for face selection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.elements.canvas.addEventListener('click', (event) => this.onCanvasClick(event));
        this.elements.canvas.addEventListener('mousemove', (event) => this.onCanvasMouseMove(event));
    }

    onCanvasClick(event) {
        if (!this.sceneInitialized) return;
        
        // Calculate mouse position in normalized device coordinates
        const rect = this.elements.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Cast ray and find intersections
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.faceMeshes);
        
        if (intersects.length > 0) {
            const intersectedMesh = intersects[0].object;
            this.selectFace(intersectedMesh);
        }
    }

    onCanvasMouseMove(event) {
        if (!this.sceneInitialized) return;
        
        // Calculate mouse position for hover effects
        const rect = this.elements.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        // Cast ray and highlight hovered face
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.faceMeshes);
        
        // Reset all face materials to default
        this.faceMeshes.forEach(mesh => {
            if (!this.selectedFaces.has(mesh.userData.faceId)) {
                mesh.material.color.setHex(0x808080);
                mesh.material.emissive.setHex(0x000000);
            }
        });
        
        // Highlight hovered face
        if (intersects.length > 0) {
            const hoveredMesh = intersects[0].object;
            if (!this.selectedFaces.has(hoveredMesh.userData.faceId)) {
                hoveredMesh.material.emissive.setHex(0x222222);
            }
            this.elements.canvas.style.cursor = 'pointer';
        } else {
            this.elements.canvas.style.cursor = 'default';
        }
    }

    selectFace(mesh) {
        const faceId = mesh.userData.faceId;
        
        if (this.selectedFaces.has(faceId)) {
            // Deselect face
            this.selectedFaces.delete(faceId);
            mesh.material.color.setHex(0x808080);
            mesh.material.emissive.setHex(0x000000);
            console.log(`🔘 Deselected face: ${faceId}`);
        } else {
            // Select face with color based on current component
            this.selectedFaces.add(faceId);
            if (this.currentComponent === 'inlet') {
                mesh.material.color.setHex(0x4CAF50); // Green for inlet
                mesh.material.emissive.setHex(0x002200);
            } else if (this.currentComponent === 'riser') {
                mesh.material.color.setHex(0x2196F3); // Blue for riser
                mesh.material.emissive.setHex(0x000022);
            }
            console.log(`✅ Selected ${this.currentComponent} face: ${faceId}`, mesh.userData.faceInfo);
        }
        
        console.log(`📊 Selected ${this.currentComponent} faces: ${this.selectedFaces.size}`);
    }

    setupOrbitControls() {
        let isRotating = false;
        let isPanning = false;
        let lastMouseX = 0;
        let lastMouseY = 0;

        const canvas = this.renderer.domElement;

        canvas.addEventListener('mousedown', (event) => {
            if (event.button === 0) isRotating = true;
            if (event.button === 1) isPanning = true;
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
        });

        canvas.addEventListener('mousemove', (event) => {
            if (!isRotating && !isPanning) return;

            const deltaX = event.clientX - lastMouseX;
            const deltaY = event.clientY - lastMouseY;

            if (isRotating) {
                this.rotateCamera(deltaX, deltaY);
            }

            if (isPanning) {
                this.panCamera(deltaX, deltaY);
            }

            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
        });

        canvas.addEventListener('mouseup', () => {
            isRotating = false;
            isPanning = false;
        });

        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            this.zoomCamera(event.deltaY);
        });

        this.setupTouchControls(canvas);
    }

    setupTouchControls(canvas) {
        let touches = [];

        canvas.addEventListener('touchstart', (event) => {
            touches = Array.from(event.touches);
        });

        canvas.addEventListener('touchmove', (event) => {
            event.preventDefault();
            const currentTouches = Array.from(event.touches);
            
            if (touches.length === 1 && currentTouches.length === 1) {
                const deltaX = currentTouches[0].clientX - touches[0].clientX;
                const deltaY = currentTouches[0].clientY - touches[0].clientY;
                this.rotateCamera(deltaX, deltaY);
            }
            
            touches = currentTouches;
        });
    }

    rotateCamera(deltaX, deltaY) {
        const spherical = new THREE.Spherical();
        spherical.setFromVector3(this.camera.position);
        spherical.theta -= deltaX * 0.01;
        spherical.phi += deltaY * 0.01;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
        this.camera.position.setFromSpherical(spherical);
        this.camera.lookAt(0, 0, 0);
    }

    panCamera(deltaX, deltaY) {
        const distance = this.camera.position.length();
        const panSpeed = distance * 0.001;
        this.camera.position.x -= deltaX * panSpeed;
        this.camera.position.y += deltaY * panSpeed;
    }

    zoomCamera(delta) {
        const zoomSpeed = 0.3; // Increased from 0.1 for more responsive zooming
        const direction = this.camera.position.clone().normalize();
        const distance = delta * zoomSpeed;
        this.camera.position.add(direction.multiplyScalar(distance));
    }

    setupEventListeners() {
        this.elements.uploadArea.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        this.elements.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.uploadArea.classList.add('dragover');
        });

        this.elements.uploadArea.addEventListener('dragleave', () => {
            this.elements.uploadArea.classList.remove('dragover');
        });

        this.elements.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFile(files[0]);
            }
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFile(e.target.files[0]);
            }
        });

        window.addEventListener('resize', () => this.onWindowResize());
    }

    startRenderLoop() {
        const animate = () => {
            requestAnimationFrame(animate);
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }

    onWindowResize() {
        if (!this.sceneInitialized) return;
        
        const canvas = this.renderer.domElement;
        this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    }

    async handleFile(file) {
        const allowedTypes = ['.step', '.stp', '.iges', '.igs'];
        const fileExt = '.' + file.name.split('.').pop().toLowerCase();
        
        if (!allowedTypes.includes(fileExt)) {
            this.showMessage('Invalid file type. Please upload STEP or IGES files.', 'error');
            return;
        }

        console.log('📁 Processing file:', file.name);

        this.showLoading(true);
        this.clearMessages();

        const statusMessages = [
            'Uploading file...',
            'Parsing geometry...',
            'Extracting meshes...',
            'Mapping faces to triangles...',
            'Creating individual face meshes...',
            'Preparing 3D scene...'
        ];

        let messageIndex = 0;
        const updateStatus = () => {
            if (messageIndex < statusMessages.length) {
                this.elements.loadingStatus.textContent = statusMessages[messageIndex];
                messageIndex++;
            }
        };

        const progressInterval = this.startProgressSimulation(updateStatus);

        try {
            const result = await this.processStepFile(file);

            clearInterval(progressInterval);
            this.elements.progressFill.style.width = '100%';
            this.elements.loadingStatus.textContent = 'Loading complete!';

            if (result.success) {
                this.pendingMeshes = result.data.meshes;
                
                this.updateStats({
                    ...result.data.statistics,
                    fileName: file.name,
                    fileSize: file.size
                });
                
                console.log('✅ File processed successfully, transitioning to viewport...');
                
                setTimeout(() => {
                    this.transitionToViewport();
                }, 1000);
                
            } else {
                throw new Error(result.error || 'Processing failed');
            }

        } catch (error) {
            clearInterval(progressInterval);
            console.error('❌ Processing error:', error);
            this.showMessage(`Processing failed: ${error.message}`, 'error');
            this.showLoading(false);
        }
    }

    async processStepFile(file) {
        const formData = new FormData();
        formData.append('stepFile', file);

        const response = await fetch('/process-step', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        console.log('🔍 Server response:', result);
        if (result.success && result.data) {
            console.log('📊 Mesh count:', result.data.meshes?.length);
            console.log('📈 First mesh data:', result.data.meshes?.[0]);
            console.log('📋 Statistics:', result.data.statistics);
            console.log('🎯 Face mapping data available:', result.data.meshes?.[0]?.faces?.length || 0, 'faces');
        }
        
        return result;
    }

    startProgressSimulation(statusCallback) {
        let progress = 0;
        return setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 85) progress = 85;
            this.elements.progressFill.style.width = progress + '%';
            
            if (statusCallback && Math.random() > 0.7) {
                statusCallback();
            }
        }, 300);
    }

    displayMeshes(meshes) {
        console.log('🎬 Starting to display meshes with per-face mesh creation:', meshes);
        
        if (!meshes || meshes.length === 0) {
            console.error('❌ No meshes to display!');
            this.showMessage('No 3D geometry found in the file', 'error');
            return;
        }

        this.clearScene();
        
        // Show typing effect after model loads - start with inlet
        setTimeout(() => {
            console.log('🎬 Attempting to show "Select the inlet" typing effect...');
            this.showTypingEffect("Select the inlet");
        }, 1500);

        let successfulFaces = 0;
        
        meshes.forEach((meshData, meshIndex) => {
            try {
                console.log(`🔧 Processing mesh ${meshIndex}:`, {
                    vertices: meshData.vertices?.length,
                    indices: meshData.indices?.length,
                    faces: meshData.faces?.length
                });
                
                // Create individual meshes for each face
                if (meshData.faces && meshData.faces.length > 0) {
                    meshData.faces.forEach((faceData, faceIndex) => {
                        try {
                            const faceMesh = this.createFaceMesh(faceData, meshData, meshIndex, faceIndex);
                            if (faceMesh) {
                                this.scene.add(faceMesh);
                                this.faceMeshes.push(faceMesh);
                                this.faceMapping.set(faceData.id, faceMesh);
                                successfulFaces++;
                                
                                console.log(`✅ Face mesh ${faceData.id} created: ${faceData.vertexCount} vertices, ${faceData.triangleCount} triangles`);
                            }
                        } catch (error) {
                            console.error(`❌ Failed to create face mesh ${faceData.id}:`, error);
                        }
                    });
                } else {
                    console.warn('⚠️ No face data available, creating single mesh');
                    // Fallback to single mesh if no face data
                    const mesh = this.createMeshFromData(meshData, meshIndex);
                    if (mesh) {
                        this.scene.add(mesh);
                        this.loadedMeshes.push(mesh);
                    }
                }
                
            } catch (error) {
                console.error(`❌ Failed to process mesh ${meshIndex}:`, error);
            }
        });

        if (successfulFaces === 0 && this.loadedMeshes.length === 0) {
            console.error('❌ No meshes could be created!');
            this.showMessage('Failed to create 3D geometry', 'error');
            return;
        }

        setTimeout(() => {
            this.fitToScreen();
        }, 100);
        
        console.log(`✅ Successfully created ${successfulFaces} individual face meshes`);
        console.log(`📊 Total objects in scene: ${this.faceMeshes.length + this.loadedMeshes.length}`);
    }

    createFaceMesh(faceData, parentMeshData, meshIndex, faceIndex) {
        // Create geometry for this specific face
        const geometry = new THREE.BufferGeometry();
        
        // Use the face's vertex data directly
        if (!faceData.vertices || faceData.vertices.length === 0) {
            console.warn(`⚠️ Face ${faceData.id} has no vertex data`);
            return null;
        }
        
        // Flatten vertex array for BufferGeometry
        const vertices = new Float32Array(faceData.vertices.flat());
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        // Create indices for the face triangles
        if (faceData.triangleIndices && faceData.triangleIndices.length > 0) {
            // Map global triangle indices to local face vertices
            const localIndices = this.createLocalIndicesForFace(faceData, parentMeshData);
            if (localIndices && localIndices.length > 0) {
                geometry.setIndex(localIndices);
            }
        }
        
        // Compute normals if not provided
        geometry.computeVertexNormals();
        
        // Create material for this face
        const material = this.createFaceMaterial(faceData);
        
        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `face-${faceData.id}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Store face metadata
        mesh.userData = {
            faceId: faceData.id,
            faceIndex: faceData.faceIndex,
            meshIndex: meshIndex,
            faceInfo: faceData,
            originalVertexCount: faceData.vertexCount,
            originalTriangleCount: faceData.triangleCount,
            area: faceData.area,
            center: faceData.center,
            normal: faceData.normal
        };
        
        return mesh;
    }

    createLocalIndicesForFace(faceData, parentMeshData) {
        // Since we're using the face's own vertex data, we need to create
        // local triangle indices that reference the face's vertex array
        const localIndices = [];
        
        // For each triangle in this face, map it to local vertices
        if (faceData.triangleIndices && parentMeshData.indices) {
            const globalIndices = parentMeshData.indices;
            
            faceData.triangleIndices.forEach(triangleIndex => {
                // Get the global triangle
                const startIdx = triangleIndex * 3;
                if (startIdx + 2 < globalIndices.length) {
                    const globalVert1 = globalIndices[startIdx];
                    const globalVert2 = globalIndices[startIdx + 1];
                    const globalVert3 = globalIndices[startIdx + 2];
                    
                    // Map to local vertex indices within this face
                    const localVert1 = faceData.vertexIndices.indexOf(globalVert1);
                    const localVert2 = faceData.vertexIndices.indexOf(globalVert2);
                    const localVert3 = faceData.vertexIndices.indexOf(globalVert3);
                    
                    if (localVert1 >= 0 && localVert2 >= 0 && localVert3 >= 0) {
                        localIndices.push(localVert1, localVert2, localVert3);
                    }
                }
            });
        } else {
            // Fallback: create simple triangle indices for the face vertices
            for (let i = 0; i < faceData.vertices.length - 2; i += 3) {
                localIndices.push(i, i + 1, i + 2);
            }
        }
        
        return localIndices.length > 0 ? localIndices : null;
    }

    createFaceMaterial(faceData) {
        // Create a unique material for each face with slight color variation
        const hue = (faceData.faceIndex * 137.5) % 360; // Golden angle for good distribution
        const saturation = 0.3 + (faceData.area % 1) * 0.3; // Vary saturation based on area
        const lightness = 0.5 + (faceData.faceIndex % 3) * 0.1; // Slight lightness variation
        
        const color = new THREE.Color().setHSL(hue / 360, saturation, lightness);
        
        return new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.3,
            roughness: 0.4,
            transparent: false,
            side: THREE.DoubleSide // Show both sides of faces
        });
    }

    createMeshFromData(meshData, index) {
        // Fallback method for when face data is not available
        const geometry = new THREE.BufferGeometry();
        
        geometry.setAttribute('position', 
            new THREE.Float32BufferAttribute(meshData.vertices, 3));
        
        if (meshData.normals && meshData.normals.length > 0) {
            geometry.setAttribute('normal', 
                new THREE.Float32BufferAttribute(meshData.normals, 3));
        } else {
            geometry.computeVertexNormals();
        }
        
        if (meshData.indices && meshData.indices.length > 0) {
            geometry.setIndex(meshData.indices);
        }

        const material = new THREE.MeshStandardMaterial({
            color: 0x808080,
            metalness: 0.3,
            roughness: 0.4
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `step-mesh-${index}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        return mesh;
    }

    updateStats(stats) {
        console.log('📊 Model Stats:', {
            fileName: stats.fileName,
            fileSize: this.formatFileSize(stats.fileSize || 0),
            faceCount: this.faceMeshes.length,
            meshCount: this.loadedMeshes.length,
            vertices: stats.totalVertices?.toLocaleString(),
            triangles: stats.totalTriangles?.toLocaleString()
        });
    }

    // Face selection methods
    getSelectedFaces() {
        return Array.from(this.selectedFaces).map(faceId => {
            const mesh = this.faceMapping.get(faceId);
            return mesh ? mesh.userData.faceInfo : null;
        }).filter(Boolean);
    }

    clearFaceSelection() {
        this.selectedFaces.clear();
        this.faceMeshes.forEach(mesh => {
            mesh.material.color.setHex(0x808080);
            mesh.material.emissive.setHex(0x000000);
        });
        console.log(`🔘 Cleared all face selections (${this.currentComponent} mode)`);
    }

    exportSelectedFaces() {
        const selectedFaces = this.getSelectedFaces();
        if (selectedFaces.length === 0) {
            this.showMessage('No faces selected for export', 'warning');
            return;
        }
        
        console.log('📤 Exporting selected faces:', selectedFaces);
        // Implementation for STL export would go here
        this.showMessage(`Selected ${selectedFaces.length} faces for export`, 'success');
    }

    showLoading(show) {
        this.elements.loading.style.display = show ? 'block' : 'none';
        if (!show) {
            this.elements.progressFill.style.width = '0%';
        }
    }

    showMessage(message, type) {
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        messageEl.textContent = message;
        this.elements.messageArea.appendChild(messageEl);
        
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        }, 5000);
    }

    clearMessages() {
        this.elements.messageArea.innerHTML = '';
    }

    transitionToViewport() {
        console.log('🔄 Starting transition to viewport...');
        
        this.elements.uploadPage.classList.add('hidden');
        
        setTimeout(() => {
            this.elements.uploadPage.style.display = 'none';
            this.elements.viewportPage.classList.add('active');
            
            console.log('📄 Viewport page is now active');
            
            setTimeout(() => {
                if (!this.sceneInitialized) {
                    this.initScene();
                }
                
                setTimeout(() => {
                    this.onWindowResize();
                    
                    if (this.pendingMeshes) {
                        console.log('🔄 Creating individual face meshes...');
                        this.displayMeshes(this.pendingMeshes);
                        this.pendingMeshes = null;
                    }
                }, 200);
            }, 100);
            
        }, 500);
        
        this.showLoading(false);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    resetCamera() {
        if (!this.sceneInitialized) return;
        this.camera.position.set(10, 10, 10);
        this.camera.lookAt(0, 0, 0);
    }

    fitToScreen() {
        if (!this.sceneInitialized) return;
        
        const allMeshes = [...this.faceMeshes, ...this.loadedMeshes];
        if (allMeshes.length === 0) return;

        const box = new THREE.Box3();
        allMeshes.forEach(mesh => {
            box.expandByObject(mesh);
        });

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        const distance = maxDim * 2;
        this.camera.position.set(distance, distance, distance);
        this.camera.lookAt(center);
    }

    clearScene() {
        if (!this.sceneInitialized) return;
        
        // Hide typing overlay when clearing scene
        if (this.elements.typingOverlay) {
            this.elements.typingOverlay.style.display = 'none';
        }
        
        // Clear face meshes
        this.faceMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        this.faceMeshes = [];
        this.faceMapping.clear();
        this.selectedFaces.clear();
        
        // Clear regular meshes
        this.loadedMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        });
        this.loadedMeshes = [];
    }

    goBackToUpload() {
        this.clearScene();
        
        this.elements.viewportPage.classList.remove('active');
        
        setTimeout(() => {
            this.elements.uploadPage.style.display = 'flex';
            this.elements.uploadPage.classList.remove('hidden');
            
            this.elements.fileInput.value = '';
            this.clearMessages();
            
        }, 300);
    }

    // Enhanced face operations
    selectAllFaces() {
        this.faceMeshes.forEach(mesh => {
            const faceId = mesh.userData.faceId;
            this.selectedFaces.add(faceId);
            mesh.material.color.setHex(0x4CAF50);
            mesh.material.emissive.setHex(0x002200);
        });
        console.log(`✅ Selected all ${this.faceMeshes.length} faces`);
    }

    selectFacesByArea(minArea, maxArea) {
        let selectedCount = 0;
        this.faceMeshes.forEach(mesh => {
            const area = mesh.userData.area || 0;
            if (area >= minArea && area <= maxArea) {
                const faceId = mesh.userData.faceId;
                this.selectedFaces.add(faceId);
                mesh.material.color.setHex(0x4CAF50);
                mesh.material.emissive.setHex(0x002200);
                selectedCount++;
            }
        });
        console.log(`✅ Selected ${selectedCount} faces with area between ${minArea} and ${maxArea}`);
    }

    selectTopFaces(tolerance = 0.1) {
        const upVector = [0, 1, 0]; // Y-up
        this.highlightFacesByNormal(upVector, tolerance);
    }

    getFaceInfo(faceId) {
        const mesh = this.faceMapping.get(faceId);
        return mesh ? mesh.userData.faceInfo : null;
    }

    highlightFacesByNormal(targetNormal, tolerance = 0.1) {
        let highlightedCount = 0;
        this.faceMeshes.forEach(mesh => {
            const faceNormal = mesh.userData.normal;
            if (faceNormal) {
                // Calculate dot product to measure alignment
                const dotProduct = faceNormal[0] * targetNormal[0] + 
                                 faceNormal[1] * targetNormal[1] + 
                                 faceNormal[2] * targetNormal[2];
                
                if (Math.abs(dotProduct - 1) < tolerance) {
                    const faceId = mesh.userData.faceId;
                    this.selectedFaces.add(faceId);
                    mesh.material.color.setHex(0xFF9800); // Orange highlight
                    mesh.material.emissive.setHex(0x331A00);
                    highlightedCount++;
                }
            }
        });
        console.log(`🎯 Selected ${highlightedCount} faces with similar normal to [${targetNormal.join(', ')}]`);
    }

    createFaceStatistics() {
        if (this.faceMeshes.length === 0) {
            console.log('📊 No faces to analyze');
            return null;
        }
        
        const areas = this.faceMeshes.map(mesh => mesh.userData.area || 0);
        const vertexCounts = this.faceMeshes.map(mesh => mesh.userData.originalVertexCount || 0);
        const triangleCounts = this.faceMeshes.map(mesh => mesh.userData.originalTriangleCount || 0);
        
        const stats = {
            totalFaces: this.faceMeshes.length,
            selectedFaces: this.selectedFaces.size,
            areas: {
                min: Math.min(...areas),
                max: Math.max(...areas),
                average: areas.reduce((a, b) => a + b, 0) / areas.length,
                total: areas.reduce((a, b) => a + b, 0)
            },
            vertices: {
                min: Math.min(...vertexCounts),
                max: Math.max(...vertexCounts),
                average: vertexCounts.reduce((a, b) => a + b, 0) / vertexCounts.length,
                total: vertexCounts.reduce((a, b) => a + b, 0)
            },
            triangles: {
                min: Math.min(...triangleCounts),
                max: Math.max(...triangleCounts),
                average: triangleCounts.reduce((a, b) => a + b, 0) / triangleCounts.length,
                total: triangleCounts.reduce((a, b) => a + b, 0)
            }
        };
        
        console.log('📊 Face Statistics:', stats);
        return stats;
    }

    exportSelectedFacesToSTL() {
        const selectedFaces = this.getSelectedFaces();
        if (selectedFaces.length === 0) {
            this.showMessage('No faces selected for export', 'warning');
            return;
        }
        
        let stlContent = 'solid SelectedFaces\n';
        
        this.selectedFaces.forEach(faceId => {
            const mesh = this.faceMapping.get(faceId);
            if (!mesh) return;
            
            const geometry = mesh.geometry;
            const position = geometry.attributes.position;
            const index = geometry.index;
            
            if (index) {
                for (let i = 0; i < index.count; i += 3) {
                    const a = index.getX(i);
                    const b = index.getX(i + 1);
                    const c = index.getX(i + 2);
                    
                    const v1 = [position.getX(a), position.getY(a), position.getZ(a)];
                    const v2 = [position.getX(b), position.getY(b), position.getZ(b)];
                    const v3 = [position.getX(c), position.getY(c), position.getZ(c)];
                    
                    const normal = this.calculateTriangleNormal(v1, v2, v3);
                    
                    stlContent += `  facet normal ${normal[0]} ${normal[1]} ${normal[2]}\n`;
                    stlContent += `    outer loop\n`;
                    stlContent += `      vertex ${v1[0]} ${v1[1]} ${v1[2]}\n`;
                    stlContent += `      vertex ${v2[0]} ${v2[1]} ${v2[2]}\n`;
                    stlContent += `      vertex ${v3[0]} ${v3[1]} ${v3[2]}\n`;
                    stlContent += `    endloop\n`;
                    stlContent += `  endfacet\n`;
                }
            } else {
                for (let i = 0; i < position.count; i += 3) {
                    const v1 = [position.getX(i), position.getY(i), position.getZ(i)];
                    const v2 = [position.getX(i + 1), position.getY(i + 1), position.getZ(i + 1)];
                    const v3 = [position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2)];
                    
                    const normal = this.calculateTriangleNormal(v1, v2, v3);
                    
                    stlContent += `  facet normal ${normal[0]} ${normal[1]} ${normal[2]}\n`;
                    stlContent += `    outer loop\n`;
                    stlContent += `      vertex ${v1[0]} ${v1[1]} ${v1[2]}\n`;
                    stlContent += `      vertex ${v2[0]} ${v2[1]} ${v2[2]}\n`;
                    stlContent += `      vertex ${v3[0]} ${v3[1]} ${v3[2]}\n`;
                    stlContent += `    endloop\n`;
                    stlContent += `  endfacet\n`;
                }
            }
        });
        
        stlContent += 'endsolid SelectedFaces\n';
        
        const metadata = {
            selectedFaceCount: selectedFaces.length,
            exportTimestamp: new Date().toISOString(),
            totalArea: selectedFaces.reduce((sum, face) => sum + (face.area || 0), 0),
            totalVertices: selectedFaces.reduce((sum, face) => sum + (face.vertexCount || 0), 0),
            totalTriangles: selectedFaces.reduce((sum, face) => sum + (face.triangleCount || 0), 0)
        };
        
        this.exportToServer(stlContent, metadata);
    }

    async exportToServer(stlContent, metadata) {
        try {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const projectId = `step-export-${timestamp.slice(0, 10)}`;
            const groupName = this.currentComponent; // Use current component name (inlet or riser)
            
            const stlBase64 = btoa(stlContent);
            
            const requestData = {
                projectId: projectId,
                groupName: groupName,
                stlData: stlBase64,
                metadata: {
                    ...metadata,
                    componentType: this.currentComponent,
                    description: `${this.currentComponent.charAt(0).toUpperCase() + this.currentComponent.slice(1)} faces selected from STEP model`
                }
            };
            
            const response = await fetch('/api/store-stl', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log(`📤 ${this.currentComponent.toUpperCase()} STL exported to server:`, result);
                this.showMessage(`Exported ${metadata.selectedFaceCount} ${this.currentComponent} faces to server as ${this.currentComponent}.stl`, 'success');
                
                // Mark component as exported
                this.componentExported[this.currentComponent] = true;
                
                // Show success typing effect
                setTimeout(() => {
                    this.showTypingEffect(`${this.currentComponent.charAt(0).toUpperCase() + this.currentComponent.slice(1)} saved as ${this.currentComponent}.stl ✓`, 30); // Using 30ms speed
                    
                    // After export success, check if we need to move to next component
                    setTimeout(() => {
                        this.checkNextComponent();
                    }, 4000);
                }, 500);
            } else {
                throw new Error(result.error || 'Server export failed');
            }
            
        } catch (error) {
            console.error('Export failed:', error);
            this.showMessage('Export failed: ' + error.message, 'error');
        }
    }

    checkNextComponent() {
        // Clear current selection after export
        this.clearFaceSelection();
        
        // If inlet is exported but riser is not, switch to riser
        if (this.componentExported.inlet && !this.componentExported.riser) {
            this.currentComponent = 'riser';
            setTimeout(() => {
                this.showTypingEffect("Select the riser");
            }, 1000);
        } else if (this.componentExported.inlet && this.componentExported.riser) {
            // Both components exported
            setTimeout(() => {
                this.showTypingEffect("Both components exported! ✓✓", 30); // Using 30ms speed
            }, 1000);
        }
    }

    // Method to manually switch component if needed
    switchToRiser() {
        this.currentComponent = 'riser';
        this.clearFaceSelection();
        this.showTypingEffect("Select the riser");
        console.log('🔄 Switched to riser selection mode');
    }

    switchToInlet() {
        this.currentComponent = 'inlet';
        this.clearFaceSelection();
        this.showTypingEffect("Select the inlet");
        console.log('🔄 Switched to inlet selection mode');
    }

    async checkProjectStatus(projectId) {
        try {
            const response = await fetch(`/api/project/${projectId}`);
            const result = await response.json();
            if (result.success) {
                console.log('📋 Project status:', result);
                return result;
            }
        } catch (error) {
            console.error('Failed to check project:', error);
        }
        return null;
    }

    async listServerProjects() {
        try {
            const response = await fetch('/api/list-projects');
            const result = await response.json();
            if (result.success) {
                console.log('📁 Available projects:', result.projects);
                return result.projects;
            }
        } catch (error) {
            console.error('Failed to list projects:', error);
        }
        return [];
    }

    calculateTriangleNormal(v1, v2, v3) {
        // Calculate triangle normal using cross product
        const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
        const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
        
        const normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
        ];
        
        // Normalize
        const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
        if (length > 0) {
            return [normal[0] / length, normal[1] / length, normal[2] / length];
        }
        return [0, 0, 1];
    }

    showHelp() {
        const helpText = `
🎯 STEP Viewer - Inlet & Riser Selection Tool

📊 Model Info:
• stepViewer.faceMeshes.length - Number of face meshes
• stepViewer.selectedFaces.size - Number of selected faces  
• stepViewer.currentComponent - Current mode: '${this.currentComponent}'
• stepViewer.componentExported - Export status: ${JSON.stringify(this.componentExported)}

🎨 Visualization Controls:
• Ctrl+C - Clear selection
• Ctrl+E - Export current component
• Ctrl+A - Select all faces
• Click faces to select/deselect
• Mouse wheel to zoom
• Drag to rotate
• Middle-click drag to pan

🔧 Component Selection:
• Green faces = Inlet selection
• Blue faces = Riser selection
• switchToInlet() - Switch to inlet mode
• switchToRiser() - Switch to riser mode

📝 Available Commands:
• selectFacesByArea(min, max) - Select faces by area range
• selectTopFaces(tolerance) - Select horizontal top faces
• highlightFacesByNormal([x,y,z], tolerance) - Select by normal vector
• exportSTL() - Export current component to server
• getFaceStatistics() - Get detailed statistics
• listProjects() - Show all server projects
• showHelp() - Display this help

📖 Workflow:
1. Select inlet faces (green) → Export → inlet.stl
2. Automatically switches to riser mode
3. Select riser faces (blue) → Export → riser.stl
4. Both components exported! ✓✓
`;
        
        console.log(helpText);
        return "Help displayed in console ⬆️";
    }
}

// Initialize the viewer when the page loads
let stepViewer;

document.addEventListener('DOMContentLoaded', () => {
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded. Please ensure the Three.js script is included.');
        return;
    }
    
    stepViewer = new StepViewer();
    window.stepViewer = stepViewer;
    
    // Add keyboard shortcuts for face operations
    document.addEventListener('keydown', (event) => {
        if (!stepViewer.sceneInitialized) return;
        
        switch(event.key.toLowerCase()) {
            case 'c':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    stepViewer.clearFaceSelection();
                }
                break;
            case 'e':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    stepViewer.exportSelectedFacesToSTL();
                }
                break;
            case 'a':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    stepViewer.selectAllFaces();
                }
                break;
        }
    });
});

// Global convenience functions
window.selectFacesByArea = function(min, max) {
    if (stepViewer) stepViewer.selectFacesByArea(min, max);
};

window.selectTopFaces = function(tolerance = 0.1) {
    if (stepViewer) stepViewer.selectTopFaces(tolerance);
};

window.highlightFacesByNormal = function(normal, tolerance = 0.1) {
    if (stepViewer) stepViewer.highlightFacesByNormal(normal, tolerance);
};

window.getFaceStatistics = function() {
    return stepViewer ? stepViewer.createFaceStatistics() : null;
};

window.exportSTL = function() {
    if (stepViewer) stepViewer.exportSelectedFacesToSTL();
};

window.listProjects = async function() {
    if (stepViewer) return await stepViewer.listServerProjects();
};

window.checkProject = async function(projectId) {
    if (stepViewer) return await stepViewer.checkProjectStatus(projectId);
};

window.showHelp = function() {
    if (stepViewer) return stepViewer.showHelp();
};

// Component switching functions
window.switchToInlet = function() {
    if (stepViewer) stepViewer.switchToInlet();
};

window.switchToRiser = function() {
    if (stepViewer) stepViewer.switchToRiser();
};

// Auto-show help on first load
console.log("🎯 STEP Viewer loaded! Type showHelp() for available commands.");

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StepViewer;
}