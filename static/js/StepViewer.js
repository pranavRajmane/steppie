// static/js/StepViewer.js

import { SceneManager } from './modules/SceneManager.js';
import { CameraControls } from './modules/CameraControls.js';
import { UIManager } from './modules/UIManager.js';
import { ApiHandler } from './modules/ApiHandler.js';
import { MeshFactory } from './modules/MeshFactory.js';
import { FaceSelector } from './modules/FaceSelector.js';

/**
 * Main application class. Orchestrates all modules and manages application state.
 */
export class StepViewer {
    constructor() {
        this.ui = new UIManager();
        this.sceneManager = null; // Initialized after transition
        this.cameraControls = null;
        this.faceSelector = null;
        
        this.sceneObjects = new Map(); // Maps shape_id to Three.js object(s)
        
        this.setupEventListeners();
        console.log('🚀 Viewer Initialized');
    }
    
    initScene() {
        if (this.sceneManager) return;
        
        const canvas = this.ui.elements.canvas;
        this.sceneManager = new SceneManager(canvas);
        this.cameraControls = new CameraControls(this.sceneManager.camera, canvas);
        this.faceSelector = new FaceSelector(this.sceneManager.camera, this.sceneManager.scene, canvas);
        
        window.addEventListener('resize', () => this.sceneManager.onWindowResize());
        console.log('✅ 3D Scene Initialized');
    }

    setupEventListeners() {
        const { uploadArea, fileInput, createBoxBtn, emptyCanvasBtn } = this.ui.elements;

        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', e => e.preventDefault());
        uploadArea.addEventListener('drop', e => {
            e.preventDefault();
            if (e.dataTransfer.files.length) this.handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', e => {
            if (e.target.files.length) this.handleFile(e.target.files[0]);
        });
        
        createBoxBtn.addEventListener('click', () => this.createBox());
        emptyCanvasBtn.addEventListener('click', () => {
             this.ui.transitionToViewport(() => this.initScene());
        });
    }

    async handleFile(file) {
        this.ui.showLoading(true);
        this.ui.clearMessages();

        try {
            const result = await ApiHandler.processStepFile(file);
            if (!result.success) throw new Error(result.error);
            
            this.ui.transitionToViewport(() => {
                this.initScene();
                this.displayMeshes(result.data.meshes);
            });
        } catch (error) {
            console.error('File processing error:', error);
            this.ui.showMessage(error.message, 'error');
            this.ui.showLoading(false);
        }
    }
    
    displayMeshes(meshesData) {
        const allMeshes = [];
        meshesData.forEach(meshData => {
            const meshes = this.addMeshToScene(meshData);
            allMeshes.push(...meshes);
        });
        
        if (allMeshes.length > 0) {
            this.cameraControls.fitToScreen(allMeshes);
        }
    }

    addMeshToScene(meshData) {
        const addedMeshes = [];
        if (!meshData || !this.sceneManager) return addedMeshes;
        
        console.log(`📦 Adding object to scene with ID: ${meshData.id}`);

        if (meshData.faces && meshData.faces.length > 0) {
            meshData.faces.forEach(faceData => {
                const faceMesh = MeshFactory.createFaceMesh(faceData, meshData);
                if (faceMesh) {
                    faceMesh.userData.shapeId = meshData.id;
                    this.sceneManager.add(faceMesh);
                    addedMeshes.push(faceMesh);
                }
            });
        } else {
            const mesh = MeshFactory.createMeshFromData(meshData, this.sceneObjects.size);
            if (mesh) {
                mesh.userData.shapeId = meshData.id;
                this.sceneManager.add(mesh);
                addedMeshes.push(mesh);
            }
        }
        
        this.sceneObjects.set(meshData.id, addedMeshes);
        return addedMeshes;
    }

    async createBox() {
        this.ui.showTypingEffect("Creating box...");
        try {
            const result = await ApiHandler.createBox({ width: 20, height: 15, depth: 10 });
            if (!result.success) throw new Error(result.error);
            
            this.ui.hideTypingEffect();
            const newMeshes = this.addMeshToScene(result.mesh);
            if(newMeshes.length > 0) {
                this.cameraControls.fitToScreen(Array.from(this.sceneObjects.values()).flat());
            }
        } catch (error) {
            console.error('Box creation failed:', error);
            this.ui.showMessage(error.message, 'error');
            this.ui.hideTypingEffect();
        }
    }
}