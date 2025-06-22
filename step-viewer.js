/**
 * STEP File 3D Viewer
 * A Three.js-based 3D viewer for STEP/IGES CAD files
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
        this.currentMaterial = 'standard';
        this.sceneInitialized = false;
        this.pendingMeshes = null;
        
        // Face selection
        this.faceSelector = null;
        
        // DOM elements
        this.elements = {};
        
        // Initialize the viewer
        this.init();
    }

    init() {
        this.cacheElements();
        this.setupEventListeners();
        
        console.log('🚀 STEP Viewer initialized');
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
        this.startRenderLoop();
        
        this.sceneInitialized = true;
        console.log('✅ 3D Scene initialized successfully');
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
        const zoomSpeed = 0.1;
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
            'Calculating normals...',
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
        console.log('🎬 Starting to display meshes:', meshes);
        
        if (!meshes || meshes.length === 0) {
            console.error('❌ No meshes to display!');
            this.showMessage('No 3D geometry found in the file', 'error');
            return;
        }

        this.clearScene();

        let successfulMeshes = 0;
        
        meshes.forEach((meshData, index) => {
            try {
                console.log(`🔧 Creating mesh ${index}:`, {
                    vertices: meshData.vertices?.length,
                    indices: meshData.indices?.length,
                    normals: meshData.normals?.length
                });
                
                const mesh = this.createMeshFromData(meshData, index);
                if (mesh) {
                    this.scene.add(mesh);
                    this.loadedMeshes.push(mesh);
                    successfulMeshes++;
                    console.log(`✅ Mesh ${index} added to scene`);
                }
            } catch (error) {
                console.error(`❌ Failed to create mesh ${index}:`, error);
            }
        });

        if (successfulMeshes === 0) {
            console.error('❌ No meshes could be created!');
            this.showMessage('Failed to create 3D geometry', 'error');
            return;
        }

        setTimeout(() => {
            this.fitToScreen();
            
            // Initialize face selector after meshes are loaded
            this.initializeFaceSelector();
        }, 100);
        
        console.log(`✅ Successfully loaded ${successfulMeshes}/${meshes.length} meshes into scene`);
    }

    initializeFaceSelector() {
        console.log('🔧 Initializing face selector...');
        
        // Clean up existing face selector
        if (this.faceSelector) {
            this.faceSelector.cleanup();
        }
        
        // Use the simplified face selector that should work reliably
        if (typeof SimpleStepFaceSelector !== 'undefined') {
            this.faceSelector = new SimpleStepFaceSelector(this);
            window.simpleStepFaceSelector = this.faceSelector;
            console.log('✅ Simple STEP face selector initialized');
        } else if (typeof StepFaceMapper !== 'undefined') {
            // Fallback to advanced mapper
            this.faceSelector = new StepFaceMapper(this);
            if (this.pendingMeshes) {
                this.faceSelector.processMeshData(this.pendingMeshes);
            }
            window.stepFaceMapper = this.faceSelector;
            console.log('✅ Advanced STEP face mapper initialized');
        } else if (typeof FaceSelector !== 'undefined') {
            // Final fallback
            this.faceSelector = new FaceSelector(this);
            window.faceSelector = this.faceSelector;
            console.log('✅ Basic face selector initialized');
        } else {
            console.error('❌ No face selector classes found!');
        }
    }

    createMeshFromData(meshData, index) {
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

        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `step-mesh-${index}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        return mesh;
    }

    createMaterial() {
        // Simple default material - no color picker needed
        return new THREE.MeshStandardMaterial({
            color: 0x808080,
            metalness: 0.3,
            roughness: 0.4
        });
    }

    updateMaterials() {
        // Simplified - no material controls needed
        const newMaterial = this.createMaterial();
        this.loadedMeshes.forEach(mesh => {
            const oldMaterial = mesh.material;
            mesh.material = newMaterial.clone();
            if (oldMaterial) oldMaterial.dispose();
        });
    }

    updateStats(stats) {
        // Remove stats display - not needed
        console.log('📊 Model Stats:', {
            fileName: stats.fileName,
            fileSize: this.formatFileSize(stats.fileSize || 0),
            meshCount: stats.faces || this.loadedMeshes.length,
            vertices: stats.totalVertices?.toLocaleString(),
            triangles: stats.totalTriangles?.toLocaleString()
        });
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
                        console.log('🔄 Re-displaying pending meshes...');
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

    // Simplified public methods - only keep essential ones

    resetCamera() {
        if (!this.sceneInitialized) return;
        this.camera.position.set(10, 10, 10);
        this.camera.lookAt(0, 0, 0);
    }

    fitToScreen() {
        if (!this.sceneInitialized || this.loadedMeshes.length === 0) return;

        const box = new THREE.Box3();
        this.loadedMeshes.forEach(mesh => {
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
        
        // Clean up face selector first
        if (this.faceSelector) {
            this.faceSelector.cleanup();
            this.faceSelector = null;
            window.faceSelector = null;
        }
        
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
}

// Initialize the viewer when the page loads
let stepViewer;

document.addEventListener('DOMContentLoaded', () => {
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded. Please ensure the Three.js script is included.');
        return;
    }
    
    stepViewer = new StepViewer();
    window.StepViewer = stepViewer;
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StepViewer;
}