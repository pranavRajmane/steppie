/**
 * Simplified STEP Face Selector
 * A more reliable approach that works with the current mesh data
 */

class SimpleStepFaceSelector {
    constructor(stepViewer) {
        this.stepViewer = stepViewer;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Selection data
        this.selectedFaces = new Map(); // faceId -> groupName
        this.physicalGroups = new Map(); // groupName -> Set of faceIds
        this.faceHighlights = new Map(); // faceId -> highlight mesh
        
        // Current state
        this.highlightedFace = null;
        this.currentGroup = 'inlet';
        this.isSelectionMode = false;
        this.nextFaceId = 0;
        
        // Group colors
        this.groupColors = {
            'inlet': 0x4ecdc4,
            'outlet': 0xff6b6b,
            'wall': 0xffd93d,
            'symmetry': 0x6c5ce7,
            'interface': 0xa29bfe
        };
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.createTypingEffect();
        this.createGroupsPanel();
    }

    setupEventListeners() {
        const canvas = this.stepViewer.renderer.domElement;
        
        // Mouse move for highlighting
        canvas.addEventListener('mousemove', (event) => {
            if (!this.isSelectionMode) return;
            this.onMouseMove(event);
        });

        // Click for selection
        canvas.addEventListener('click', (event) => {
            if (!this.isSelectionMode) return;
            this.onMouseClick(event);
        });

        // Disable context menu
        canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });
        
        console.log('📡 Event listeners setup complete');
    }

    onMouseMove(event) {
        // Calculate mouse position in normalized device coordinates
        const rect = this.stepViewer.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.stepViewer.camera);
        
        // Find intersections with loaded meshes
        const intersects = this.raycaster.intersectObjects(this.stepViewer.loadedMeshes);
        
        if (intersects.length > 0) {
            const intersection = intersects[0];
            this.highlightFaceAtIntersection(intersection);
        } else {
            this.clearHighlight();
        }
    }

    highlightFaceAtIntersection(intersection) {
        // Clear previous highlight
        this.clearHighlight();
        
        // Get the intersected triangle
        const face = intersection.face;
        const mesh = intersection.object;
        const faceIndex = intersection.faceIndex;
        
        // Create a unique face identifier
        const faceId = `${mesh.uuid}_${faceIndex}`;
        
        console.log(`🎯 Highlighting face: ${faceId}`);
        
        // Create highlight for this specific triangle/face
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: this.groupColors[this.currentGroup],
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        // Create geometry for just this triangle
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        
        // Get triangle vertices
        const positionAttribute = mesh.geometry.getAttribute('position');
        const a = face.a, b = face.b, c = face.c;
        
        // Add vertices
        positions.push(
            positionAttribute.getX(a), positionAttribute.getY(a), positionAttribute.getZ(a),
            positionAttribute.getX(b), positionAttribute.getY(b), positionAttribute.getZ(b),
            positionAttribute.getX(c), positionAttribute.getY(c), positionAttribute.getZ(c)
        );
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        
        // Create highlight mesh
        const highlightMesh = new THREE.Mesh(geometry, highlightMaterial);
        
        // Apply same transform as original mesh
        highlightMesh.matrix.copy(mesh.matrix);
        highlightMesh.matrixAutoUpdate = false;
        
        this.highlightedFace = {
            mesh: highlightMesh,
            faceId: faceId,
            originalMesh: mesh,
            faceIndex: faceIndex,
            triangleData: face
        };
        
        this.stepViewer.scene.add(highlightMesh);
    }

    clearHighlight() {
        if (this.highlightedFace) {
            this.stepViewer.scene.remove(this.highlightedFace.mesh);
            this.highlightedFace.mesh.geometry.dispose();
            this.highlightedFace.mesh.material.dispose();
            this.highlightedFace = null;
        }
    }

    onMouseClick(event) {
        if (!this.highlightedFace) {
            console.log('❌ No face highlighted for selection');
            return;
        }
        
        const faceId = this.highlightedFace.faceId;
        
        console.log(`🖱️ Clicked on face: ${faceId}`);
        
        // Check if face is already selected
        if (this.selectedFaces.has(faceId)) {
            // Remove from current group
            const oldGroup = this.selectedFaces.get(faceId);
            this.removeFromGroup(faceId, oldGroup);
        } else {
            // Add to current group
            this.addToGroup(faceId, this.currentGroup);
        }
        
        this.updateGroupsList();
        this.updateFaceCount();
    }

    addToGroup(faceId, groupName) {
        // Remove from any existing group first
        for (const [existingGroup, faceSet] of this.physicalGroups) {
            if (faceSet.has(faceId)) {
                faceSet.delete(faceId);
            }
        }
        
        // Add to new group
        if (!this.physicalGroups.has(groupName)) {
            this.physicalGroups.set(groupName, new Set());
        }
        
        this.physicalGroups.get(groupName).add(faceId);
        this.selectedFaces.set(faceId, groupName);
        
        // Create persistent highlight for selected face
        this.createPersistentHighlight(faceId, groupName);
        
        console.log(`✅ Added face ${faceId} to group: ${groupName}`);
    }

    removeFromGroup(faceId, groupName) {
        if (this.physicalGroups.has(groupName)) {
            this.physicalGroups.get(groupName).delete(faceId);
        }
        this.selectedFaces.delete(faceId);
        
        // Remove persistent highlight
        this.removePersistentHighlight(faceId);
        
        console.log(`❌ Removed face ${faceId} from group: ${groupName}`);
    }

    createPersistentHighlight(faceId, groupName) {
        // Create a persistent highlight that stays visible
        const material = new THREE.MeshBasicMaterial({
            color: this.groupColors[groupName],
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide
        });
        
        // Copy the geometry from the highlighted face
        if (this.highlightedFace && this.highlightedFace.faceId === faceId) {
            const highlightMesh = new THREE.Mesh(this.highlightedFace.mesh.geometry.clone(), material);
            highlightMesh.matrix.copy(this.highlightedFace.mesh.matrix);
            highlightMesh.matrixAutoUpdate = false;
            highlightMesh.userData.faceId = faceId;
            highlightMesh.userData.groupName = groupName;
            highlightMesh.userData.isPersistent = true;
            
            this.faceHighlights.set(faceId, highlightMesh);
            this.stepViewer.scene.add(highlightMesh);
            
            console.log(`🔒 Created persistent highlight for face: ${faceId}`);
        }
    }

    removePersistentHighlight(faceId) {
        const highlightMesh = this.faceHighlights.get(faceId);
        if (highlightMesh) {
            this.stepViewer.scene.remove(highlightMesh);
            highlightMesh.geometry.dispose();
            highlightMesh.material.dispose();
            this.faceHighlights.delete(faceId);
            
            console.log(`🗑️ Removed persistent highlight for face: ${faceId}`);
        }
    }

    createTypingEffect() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-instruction';
        typingDiv.innerHTML = '<span class="typing-text" id="typingText"></span>';
        document.body.appendChild(typingDiv);

        setTimeout(() => {
            this.typeText('Click faces to select for physical groups', 'typingText', () => {
                this.enableSelectionMode();
                setTimeout(() => {
                    typingDiv.style.opacity = '0';
                    setTimeout(() => {
                        if (typingDiv.parentNode) {
                            typingDiv.parentNode.removeChild(typingDiv);
                        }
                    }, 500);
                }, 4000);
            });
        }, 1000);
    }

    typeText(text, elementId, callback) {
        const element = document.getElementById(elementId);
        let i = 0;
        
        const typeInterval = setInterval(() => {
            element.textContent = text.substring(0, i + 1);
            i++;
            
            if (i >= text.length) {
                clearInterval(typeInterval);
                if (callback) callback();
            }
        }, 60);
    }

    enableSelectionMode() {
        this.isSelectionMode = true;
        console.log('🎯 Face selection mode enabled');
        this.updateSelectionStatus();
    }

    createGroupsPanel() {
        const panel = document.createElement('div');
        panel.className = 'groups-panel';
        panel.id = 'groupsPanel';
        
        panel.innerHTML = `
            <div class="groups-title">Physical Groups</div>
            
            <div class="group-selector">
                <label>Current Group:</label>
                <select id="groupSelect" class="group-select">
                    <option value="inlet">Inlet</option>
                    <option value="outlet">Outlet</option>
                    <option value="wall">Wall</option>
                    <option value="symmetry">Symmetry</option>
                    <option value="interface">Interface</option>
                </select>
            </div>
            
            <div class="groups-list" id="groupsList">
                <!-- Groups will be populated here -->
            </div>
            
            <div class="groups-actions">
                <button class="group-btn" onclick="simpleStepFaceSelector.clearCurrentGroup()">
                    🗑️ Clear Current
                </button>
                <button class="group-btn" onclick="simpleStepFaceSelector.clearAllGroups()">
                    ❌ Clear All
                </button>
                <button class="group-btn export-btn" onclick="simpleStepFaceSelector.showExportDialog()">
                    📦 Export STL
                </button>
            </div>
            
            <div class="selection-info">
                <div>Selection Mode: <span id="selectionStatus">Active</span></div>
                <div>Selected Faces: <span id="faceCount">0</span></div>
            </div>
        `;
        
        document.body.appendChild(panel);
        
        // Setup group selector event
        document.getElementById('groupSelect').addEventListener('change', (e) => {
            this.currentGroup = e.target.value;
            this.updateGroupHighlights();
            console.log(`🔄 Switched to group: ${this.currentGroup}`);
        });
        
        // Show panel after a delay
        setTimeout(() => {
            panel.classList.add('visible');
        }, 2000);
    }

    updateGroupsList() {
        const groupsList = document.getElementById('groupsList');
        if (!groupsList) return;
        
        groupsList.innerHTML = '';
        
        for (const [groupName, faceSet] of this.physicalGroups) {
            if (faceSet.size > 0) {
                const groupDiv = document.createElement('div');
                groupDiv.className = 'group-item';
                groupDiv.innerHTML = `
                    <div class="group-info">
                        <span class="group-color" style="background-color: #${this.groupColors[groupName].toString(16).padStart(6, '0')}"></span>
                        <span class="group-name">${groupName}</span>
                        <span class="group-count">${faceSet.size} faces</span>
                    </div>
                `;
                groupsList.appendChild(groupDiv);
            }
        }
    }

    updateFaceCount() {
        const totalFaces = this.selectedFaces.size;
        const faceCountEl = document.getElementById('faceCount');
        if (faceCountEl) {
            faceCountEl.textContent = totalFaces;
        }
    }

    updateSelectionStatus() {
        const statusEl = document.getElementById('selectionStatus');
        if (statusEl) {
            statusEl.textContent = this.isSelectionMode ? 'Active' : 'Inactive';
            statusEl.style.color = this.isSelectionMode ? '#4ecdc4' : '#ff6b6b';
        }
    }

    updateGroupHighlights() {
        // Update opacity based on current selection
        this.faceHighlights.forEach((mesh, faceId) => {
            if (mesh.userData.groupName === this.currentGroup) {
                mesh.material.opacity = 0.7;
            } else {
                mesh.material.opacity = 0.3;
            }
        });
    }

    clearCurrentGroup() {
        const faceSet = this.physicalGroups.get(this.currentGroup);
        if (faceSet) {
            // Remove all faces from this group
            for (const faceId of faceSet) {
                this.selectedFaces.delete(faceId);
                this.removePersistentHighlight(faceId);
            }
            faceSet.clear();
        }
        
        this.updateGroupsList();
        this.updateFaceCount();
        console.log(`🗑️ Cleared group: ${this.currentGroup}`);
    }

    clearAllGroups() {
        // Remove all persistent highlights
        for (const faceId of this.selectedFaces.keys()) {
            this.removePersistentHighlight(faceId);
        }
        
        this.selectedFaces.clear();
        this.physicalGroups.clear();
        this.updateGroupsList();
        this.updateFaceCount();
        console.log('❌ Cleared all groups');
    }

    showExportDialog() {
        // Create export dialog
        const dialog = document.createElement('div');
        dialog.className = 'export-dialog';
        dialog.innerHTML = `
            <div class="export-content">
                <h3>Export Physical Groups</h3>
                <div class="export-options">
                    ${Array.from(this.physicalGroups.entries())
                        .filter(([name, faceSet]) => faceSet.size > 0)
                        .map(([name, faceSet]) => `
                            <label class="export-option">
                                <input type="checkbox" value="${name}" checked>
                                ${name} (${faceSet.size} faces)
                            </label>
                        `).join('')}
                </div>
                <div class="export-actions">
                    <button onclick="simpleStepFaceSelector.exportSelectedGroups()" class="export-btn">Export STL</button>
                    <button onclick="simpleStepFaceSelector.closeExportDialog()" class="cancel-btn">Cancel</button>
                </div>
            </div>
        `;
        
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                this.closeExportDialog();
            }
        });
        
        document.body.appendChild(dialog);
    }

    exportSelectedGroups() {
        const checkboxes = document.querySelectorAll('.export-option input:checked');
        const groupsToExport = Array.from(checkboxes).map(cb => cb.value);
        
        if (groupsToExport.length === 0) {
            alert('Please select at least one group to export.');
            return;
        }
        
        groupsToExport.forEach(groupName => {
            this.exportGroupAsSTL(groupName);
        });
        
        this.closeExportDialog();
    }

    exportGroupAsSTL(groupName) {
        const faceSet = this.physicalGroups.get(groupName);
        if (!faceSet || faceSet.size === 0) return;
        
        let stlContent = `solid ${groupName}\n`;
        
        // Export each selected face
        faceSet.forEach(faceId => {
            const highlightMesh = this.faceHighlights.get(faceId);
            if (!highlightMesh) return;
            
            const geometry = highlightMesh.geometry;
            const positionAttribute = geometry.getAttribute('position');
            
            // Export triangles of this face
            for (let i = 0; i < positionAttribute.count; i += 3) {
                // Get triangle vertices
                const v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                const v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 1);
                const v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 2);
                
                // Apply transformation
                v1.applyMatrix4(highlightMesh.matrix);
                v2.applyMatrix4(highlightMesh.matrix);
                v3.applyMatrix4(highlightMesh.matrix);
                
                // Calculate normal
                const normal = new THREE.Vector3()
                    .crossVectors(v2.clone().sub(v1), v3.clone().sub(v1))
                    .normalize();
                
                stlContent += `  facet normal ${normal.x.toFixed(6)} ${normal.y.toFixed(6)} ${normal.z.toFixed(6)}\n`;
                stlContent += `    outer loop\n`;
                stlContent += `      vertex ${v1.x.toFixed(6)} ${v1.y.toFixed(6)} ${v1.z.toFixed(6)}\n`;
                stlContent += `      vertex ${v2.x.toFixed(6)} ${v2.y.toFixed(6)} ${v2.z.toFixed(6)}\n`;
                stlContent += `      vertex ${v3.x.toFixed(6)} ${v3.y.toFixed(6)} ${v3.z.toFixed(6)}\n`;
                stlContent += `    endloop\n`;
                stlContent += `  endfacet\n`;
            }
        });
        
        stlContent += `endsolid ${groupName}\n`;
        
        // Create and download file
        const blob = new Blob([stlContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${groupName}_faces.stl`;
        link.click();
        URL.revokeObjectURL(url);
        
        console.log(`📦 Exported ${groupName}_faces.stl with ${faceSet.size} faces`);
    }

    closeExportDialog() {
        const dialog = document.querySelector('.export-dialog');
        if (dialog) {
            dialog.remove();
        }
    }

    cleanup() {
        this.clearAllGroups();
        this.clearHighlight();
        
        const panel = document.getElementById('groupsPanel');
        if (panel) panel.remove();
        
        const dialog = document.querySelector('.export-dialog');
        if (dialog) dialog.remove();
        
        console.log('🧹 Face selector cleanup complete');
    }
}

// Export for global access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimpleStepFaceSelector;
}