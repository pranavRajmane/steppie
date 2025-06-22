/**
 * STEP Face Mapping System
 * Maps Three.js triangles back to original STEP/CAD faces
 * Handles proper face selection at the CAD level
 */

class StepFaceMapper {
    constructor(stepViewer) {
        this.stepViewer = stepViewer;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Face mapping data structures
        this.faceMap = new Map(); // triangleId -> stepFaceId
        this.stepFaces = new Map(); // stepFaceId -> face metadata
        this.faceMeshes = new Map(); // stepFaceId -> Three.js mesh group
        this.selectedFaces = new Map(); // stepFaceId -> groupName
        this.physicalGroups = new Map(); // groupName -> Set of stepFaceIds
        
        // Visual elements
        this.highlightedFace = null;
        this.currentGroup = 'inlet';
        this.isSelectionMode = false;
        
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

    /**
     * Process mesh data and create face mapping
     * This should be called when meshes are loaded from the server
     */
    processMeshData(meshDataArray) {
        console.log('🗺️ Processing STEP face mapping...');
        
        // Clear existing mappings
        this.clearMappings();
        
        meshDataArray.forEach((meshData, meshIndex) => {
            this.processSingleMesh(meshData, meshIndex);
        });
        
        console.log(`✅ Mapped ${this.stepFaces.size} STEP faces to Three.js geometry`);
        this.updateFaceCount();
    }

    processSingleMesh(meshData, meshIndex) {
        // Extract face information from mesh data
        const faces = meshData.faces || this.extractFacesFromGeometry(meshData);
        
        faces.forEach((faceInfo, faceIndex) => {
            const stepFaceId = `face_${meshIndex}_${faceIndex}`;
            
            // Store face metadata
            this.stepFaces.set(stepFaceId, {
                id: stepFaceId,
                meshIndex: meshIndex,
                faceIndex: faceIndex,
                triangleIndices: faceInfo.triangleIndices,
                vertices: faceInfo.vertices,
                normal: faceInfo.normal,
                area: faceInfo.area,
                center: faceInfo.center,
                bounds: faceInfo.bounds
            });
            
            // Map triangles to this face
            faceInfo.triangleIndices.forEach(triangleIndex => {
                const triangleId = `${meshIndex}_${triangleIndex}`;
                this.faceMap.set(triangleId, stepFaceId);
            });
            
            // Create face mesh for selection and highlighting
            this.createFaceMesh(stepFaceId, faceInfo, meshIndex);
        });
    }

    /**
     * Extract face information from geometry data
     * This is where we need to maintain the STEP->Three.js mapping
     */
    extractFacesFromGeometry(meshData) {
        const faces = [];
        const vertices = meshData.vertices;
        const indices = meshData.indices || [];
        const normals = meshData.normals || [];
        
        // Group triangles by face based on normals and connectivity
        const faceGroups = this.groupTrianglesByFace(vertices, indices, normals);
        
        faceGroups.forEach((triangleGroup, groupIndex) => {
            const faceInfo = this.analyzeFaceGroup(triangleGroup, vertices, indices, normals);
            faces.push(faceInfo);
        });
        
        return faces;
    }

    /**
     * Group triangles that belong to the same original STEP face
     * This uses normal similarity and geometric connectivity
     */
    groupTrianglesByFace(vertices, indices, normals) {
        const triangleGroups = [];
        const processedTriangles = new Set();
        const triangleCount = indices.length / 3;
        
        for (let i = 0; i < triangleCount; i++) {
            if (processedTriangles.has(i)) continue;
            
            const group = [i];
            processedTriangles.add(i);
            
            // Get reference normal for this triangle
            const refNormal = this.getTriangleNormal(i, vertices, indices, normals);
            const refCenter = this.getTriangleCenter(i, vertices, indices);
            
            // Find connected triangles with similar normals
            for (let j = i + 1; j < triangleCount; j++) {
                if (processedTriangles.has(j)) continue;
                
                const testNormal = this.getTriangleNormal(j, vertices, indices, normals);
                const testCenter = this.getTriangleCenter(j, vertices, indices);
                
                // Check if triangles belong to same face
                if (this.trianglesBelongToSameFace(refNormal, refCenter, testNormal, testCenter)) {
                    group.push(j);
                    processedTriangles.add(j);
                }
            }
            
            triangleGroups.push(group);
        }
        
        return triangleGroups;
    }

    trianglesBelongToSameFace(normal1, center1, normal2, center2) {
        // Check normal similarity (faces should have similar normals)
        const normalThreshold = 0.95; // cos(~18 degrees)
        const normalSimilarity = normal1.dot(normal2);
        
        if (normalSimilarity < normalThreshold) return false;
        
        // Check if triangles are geometrically close
        const distanceThreshold = 0.1; // Adjust based on model scale
        const distance = center1.distanceTo(center2);
        
        return distance < distanceThreshold;
    }

    getTriangleNormal(triangleIndex, vertices, indices, normals) {
        if (normals && normals.length > 0) {
            // Use provided normals
            const idx = triangleIndex * 9; // 3 vertices * 3 components
            return new THREE.Vector3(
                (normals[idx] + normals[idx + 3] + normals[idx + 6]) / 3,
                (normals[idx + 1] + normals[idx + 4] + normals[idx + 7]) / 3,
                (normals[idx + 2] + normals[idx + 5] + normals[idx + 8]) / 3
            ).normalize();
        } else {
            // Calculate normal from vertices
            const i1 = indices[triangleIndex * 3] * 3;
            const i2 = indices[triangleIndex * 3 + 1] * 3;
            const i3 = indices[triangleIndex * 3 + 2] * 3;
            
            const v1 = new THREE.Vector3(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
            const v2 = new THREE.Vector3(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
            const v3 = new THREE.Vector3(vertices[i3], vertices[i3 + 1], vertices[i3 + 2]);
            
            const edge1 = v2.clone().sub(v1);
            const edge2 = v3.clone().sub(v1);
            
            return edge1.cross(edge2).normalize();
        }
    }

    getTriangleCenter(triangleIndex, vertices, indices) {
        const i1 = indices[triangleIndex * 3] * 3;
        const i2 = indices[triangleIndex * 3 + 1] * 3;
        const i3 = indices[triangleIndex * 3 + 2] * 3;
        
        const v1 = new THREE.Vector3(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
        const v2 = new THREE.Vector3(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
        const v3 = new THREE.Vector3(vertices[i3], vertices[i3 + 1], vertices[i3 + 2]);
        
        return v1.add(v2).add(v3).divideScalar(3);
    }

    analyzeFaceGroup(triangleGroup, vertices, indices, normals) {
        // Analyze the group of triangles to extract face properties
        const triangleIndices = triangleGroup;
        const faceVertices = [];
        const centers = [];
        
        // Collect all vertices and centers
        triangleGroup.forEach(triangleIndex => {
            const center = this.getTriangleCenter(triangleIndex, vertices, indices);
            centers.push(center);
            
            // Collect unique vertices for this face
            for (let i = 0; i < 3; i++) {
                const vertexIndex = indices[triangleIndex * 3 + i] * 3;
                const vertex = new THREE.Vector3(
                    vertices[vertexIndex],
                    vertices[vertexIndex + 1],
                    vertices[vertexIndex + 2]
                );
                
                // Add if not already present (with tolerance)
                if (!faceVertices.some(v => v.distanceTo(vertex) < 0.001)) {
                    faceVertices.push(vertex);
                }
            }
        });
        
        // Calculate face properties
        const faceCenter = centers.reduce((sum, center) => sum.add(center), new THREE.Vector3())
                                  .divideScalar(centers.length);
        
        const faceNormal = this.getTriangleNormal(triangleGroup[0], vertices, indices, normals);
        
        const bounds = this.calculateBounds(faceVertices);
        const area = this.calculateFaceArea(triangleGroup, vertices, indices);
        
        return {
            triangleIndices,
            vertices: faceVertices,
            center: faceCenter,
            normal: faceNormal,
            bounds,
            area
        };
    }

    calculateBounds(vertices) {
        const bounds = {
            min: new THREE.Vector3(Infinity, Infinity, Infinity),
            max: new THREE.Vector3(-Infinity, -Infinity, -Infinity)
        };
        
        vertices.forEach(vertex => {
            bounds.min.min(vertex);
            bounds.max.max(vertex);
        });
        
        return bounds;
    }

    calculateFaceArea(triangleIndices, vertices, indices) {
        let totalArea = 0;
        
        triangleIndices.forEach(triangleIndex => {
            const i1 = indices[triangleIndex * 3] * 3;
            const i2 = indices[triangleIndex * 3 + 1] * 3;
            const i3 = indices[triangleIndex * 3 + 2] * 3;
            
            const v1 = new THREE.Vector3(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
            const v2 = new THREE.Vector3(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
            const v3 = new THREE.Vector3(vertices[i3], vertices[i3 + 1], vertices[i3 + 2]);
            
            const edge1 = v2.clone().sub(v1);
            const edge2 = v3.clone().sub(v1);
            const area = edge1.cross(edge2).length() * 0.5;
            
            totalArea += area;
        });
        
        return totalArea;
    }

    createFaceMesh(stepFaceId, faceInfo, meshIndex) {
        // Create a Three.js mesh representing this STEP face
        const geometry = new THREE.BufferGeometry();
        
        // Create geometry from face triangles
        const positions = [];
        const originalMesh = this.stepViewer.loadedMeshes[meshIndex];
        const originalPositions = originalMesh.geometry.getAttribute('position');
        const originalIndices = originalMesh.geometry.index;
        
        faceInfo.triangleIndices.forEach(triangleIndex => {
            for (let i = 0; i < 3; i++) {
                const vertexIndex = originalIndices.getX(triangleIndex * 3 + i);
                positions.push(
                    originalPositions.getX(vertexIndex),
                    originalPositions.getY(vertexIndex),
                    originalPositions.getZ(vertexIndex)
                );
            }
        });
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        
        // Create invisible mesh for raycasting
        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide
        });
        
        const faceMesh = new THREE.Mesh(geometry, material);
        faceMesh.userData.stepFaceId = stepFaceId;
        faceMesh.userData.isStepFace = true;
        faceMesh.matrix.copy(originalMesh.matrix);
        faceMesh.matrixAutoUpdate = false;
        
        // Store the face mesh
        this.faceMeshes.set(stepFaceId, faceMesh);
        this.stepViewer.scene.add(faceMesh);
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
    }

    onMouseMove(event) {
        // Calculate mouse position in normalized device coordinates
        const rect = this.stepViewer.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.stepViewer.camera);
        
        // Find intersections with face meshes only
        const faceMeshArray = Array.from(this.faceMeshes.values());
        const intersects = this.raycaster.intersectObjects(faceMeshArray);
        
        if (intersects.length > 0) {
            const stepFaceId = intersects[0].object.userData.stepFaceId;
            this.highlightStepFace(stepFaceId);
        } else {
            this.clearHighlight();
        }
    }

    onMouseClick(event) {
        if (!this.highlightedFace) return;
        
        const stepFaceId = this.highlightedFace.stepFaceId;
        
        // Check if face is already selected
        if (this.selectedFaces.has(stepFaceId)) {
            // Remove from current group
            const oldGroup = this.selectedFaces.get(stepFaceId);
            this.removeFromGroup(stepFaceId, oldGroup);
        } else {
            // Add to current group
            this.addToGroup(stepFaceId, this.currentGroup);
        }
        
        this.updateGroupsList();
        this.updateFaceCount();
    }

    highlightStepFace(stepFaceId) {
        // Clear previous highlight
        this.clearHighlight();
        
        const faceInfo = this.stepFaces.get(stepFaceId);
        if (!faceInfo) return;
        
        // Create highlight for the entire STEP face
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: this.groupColors[this.currentGroup],
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        
        // Use the existing face mesh geometry
        const faceMesh = this.faceMeshes.get(stepFaceId);
        const highlightMesh = new THREE.Mesh(faceMesh.geometry.clone(), highlightMaterial);
        highlightMesh.matrix.copy(faceMesh.matrix);
        highlightMesh.matrixAutoUpdate = false;
        
        this.highlightedFace = {
            mesh: highlightMesh,
            stepFaceId: stepFaceId
        };
        
        this.stepViewer.scene.add(highlightMesh);
        
        console.log(`🎯 Highlighted STEP face: ${stepFaceId} (${faceInfo.area.toFixed(3)} area)`);
    }

    clearHighlight() {
        if (this.highlightedFace) {
            this.stepViewer.scene.remove(this.highlightedFace.mesh);
            this.highlightedFace.mesh.geometry.dispose();
            this.highlightedFace.mesh.material.dispose();
            this.highlightedFace = null;
        }
    }

    addToGroup(stepFaceId, groupName) {
        // Remove from any existing group
        for (const [existingGroup, faceSet] of this.physicalGroups) {
            if (faceSet.has(stepFaceId)) {
                faceSet.delete(stepFaceId);
            }
        }
        
        // Add to new group
        if (!this.physicalGroups.has(groupName)) {
            this.physicalGroups.set(groupName, new Set());
        }
        
        this.physicalGroups.get(groupName).add(stepFaceId);
        this.selectedFaces.set(stepFaceId, groupName);
        
        // Create persistent highlight for selected face
        this.createPersistentHighlight(stepFaceId, groupName);
        
        const faceInfo = this.stepFaces.get(stepFaceId);
        console.log(`✅ Added STEP face ${stepFaceId} to group: ${groupName} (Area: ${faceInfo.area.toFixed(3)})`);
    }

    removeFromGroup(stepFaceId, groupName) {
        if (this.physicalGroups.has(groupName)) {
            this.physicalGroups.get(groupName).delete(stepFaceId);
        }
        this.selectedFaces.delete(stepFaceId);
        
        // Remove persistent highlight
        this.removePersistentHighlight(stepFaceId);
        
        console.log(`❌ Removed STEP face ${stepFaceId} from group: ${groupName}`);
    }

    createPersistentHighlight(stepFaceId, groupName) {
        const material = new THREE.MeshBasicMaterial({
            color: this.groupColors[groupName],
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide
        });
        
        const faceMesh = this.faceMeshes.get(stepFaceId);
        const highlightMesh = new THREE.Mesh(faceMesh.geometry.clone(), material);
        highlightMesh.matrix.copy(faceMesh.matrix);
        highlightMesh.matrixAutoUpdate = false;
        highlightMesh.userData.stepFaceId = stepFaceId;
        highlightMesh.userData.groupName = groupName;
        highlightMesh.userData.isPersistentHighlight = true;
        
        this.stepViewer.scene.add(highlightMesh);
    }

    removePersistentHighlight(stepFaceId) {
        const meshesToRemove = [];
        this.stepViewer.scene.traverse((object) => {
            if (object.userData && 
                object.userData.stepFaceId === stepFaceId && 
                object.userData.isPersistentHighlight) {
                meshesToRemove.push(object);
            }
        });
        
        meshesToRemove.forEach(mesh => {
            this.stepViewer.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
    }

    clearMappings() {
        this.faceMap.clear();
        this.stepFaces.clear();
        
        // Clean up face meshes
        this.faceMeshes.forEach(mesh => {
            this.stepViewer.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.faceMeshes.clear();
        
        this.selectedFaces.clear();
        this.physicalGroups.clear();
    }

    // UI Methods (simplified versions of the previous implementation)
    createTypingEffect() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'typing-instruction';
        typingDiv.innerHTML = '<span class="typing-text" id="typingText"></span>';
        document.body.appendChild(typingDiv);

        setTimeout(() => {
            this.typeText('Select STEP faces for physical groups', 'typingText', () => {
                this.enableSelectionMode();
                setTimeout(() => {
                    typingDiv.style.opacity = '0';
                    setTimeout(() => {
                        if (typingDiv.parentNode) {
                            typingDiv.parentNode.removeChild(typingDiv);
                        }
                    }, 500);
                }, 3000);
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
        }, 80);
    }

    enableSelectionMode() {
        this.isSelectionMode = true;
        console.log('🎯 STEP face selection mode enabled');
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
            
            <div class="groups-list" id="groupsList"></div>
            
            <div class="groups-actions">
                <button class="group-btn" onclick="stepFaceMapper.clearCurrentGroup()">
                    🗑️ Clear Current
                </button>
                <button class="group-btn" onclick="stepFaceMapper.clearAllGroups()">
                    ❌ Clear All
                </button>
                <button class="group-btn export-btn" onclick="stepFaceMapper.showExportDialog()">
                    📦 Export STL
                </button>
            </div>
            
            <div class="selection-info">
                <div>Selection Mode: <span id="selectionStatus">Active</span></div>
                <div>Selected Faces: <span id="faceCount">0</span></div>
                <div>Total Area: <span id="totalArea">0.000</span></div>
            </div>
        `;
        
        document.body.appendChild(panel);
        
        // Setup group selector event
        document.getElementById('groupSelect').addEventListener('change', (e) => {
            this.currentGroup = e.target.value;
            this.updateGroupHighlights();
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
                // Calculate total area for this group
                let totalArea = 0;
                faceSet.forEach(stepFaceId => {
                    const faceInfo = this.stepFaces.get(stepFaceId);
                    if (faceInfo) totalArea += faceInfo.area;
                });
                
                const groupDiv = document.createElement('div');
                groupDiv.className = 'group-item';
                groupDiv.innerHTML = `
                    <div class="group-info">
                        <span class="group-color" style="background-color: #${this.groupColors[groupName].toString(16).padStart(6, '0')}"></span>
                        <span class="group-name">${groupName}</span>
                        <span class="group-count">${faceSet.size} faces (${totalArea.toFixed(3)})</span>
                    </div>
                `;
                groupsList.appendChild(groupDiv);
            }
        }
    }

    updateFaceCount() {
        const totalFaces = this.selectedFaces.size;
        const totalAreaEl = document.getElementById('totalArea');
        const faceCountEl = document.getElementById('faceCount');
        
        if (faceCountEl) faceCountEl.textContent = totalFaces;
        
        if (totalAreaEl) {
            let totalArea = 0;
            this.selectedFaces.forEach((groupName, stepFaceId) => {
                const faceInfo = this.stepFaces.get(stepFaceId);
                if (faceInfo) totalArea += faceInfo.area;
            });
            totalAreaEl.textContent = totalArea.toFixed(3);
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
        this.stepViewer.scene.traverse((object) => {
            if (object.userData && object.userData.groupName) {
                if (object.userData.groupName === this.currentGroup) {
                    object.material.opacity = 0.7;
                } else {
                    object.material.opacity = 0.3;
                }
            }
        });
    }

    clearCurrentGroup() {
        const faceSet = this.physicalGroups.get(this.currentGroup);
        if (faceSet) {
            faceSet.forEach(stepFaceId => {
                this.selectedFaces.delete(stepFaceId);
                this.removePersistentHighlight(stepFaceId);
            });
            faceSet.clear();
        }
        
        this.updateGroupsList();
        this.updateFaceCount();
        console.log(`🗑️ Cleared STEP faces from group: ${this.currentGroup}`);
    }

    clearAllGroups() {
        for (const stepFaceId of this.selectedFaces.keys()) {
            this.removePersistentHighlight(stepFaceId);
        }
        
        this.selectedFaces.clear();
        this.physicalGroups.clear();
        this.updateGroupsList();
        this.updateFaceCount();
        console.log('❌ Cleared all STEP face groups');
    }

    showExportDialog() {
        // Create export dialog for STEP faces
        const dialog = document.createElement('div');
        dialog.className = 'export-dialog';
        dialog.innerHTML = `
            <div class="export-content">
                <h3>Export STEP Face Groups</h3>
                <div class="export-options">
                    ${Array.from(this.physicalGroups.entries())
                        .filter(([name, faceSet]) => faceSet.size > 0)
                        .map(([name, faceSet]) => {
                            let totalArea = 0;
                            faceSet.forEach(stepFaceId => {
                                const faceInfo = this.stepFaces.get(stepFaceId);
                                if (faceInfo) totalArea += faceInfo.area;
                            });
                            return `
                                <label class="export-option">
                                    <input type="checkbox" value="${name}" checked>
                                    ${name} (${faceSet.size} faces, area: ${totalArea.toFixed(3)})
                                </label>
                            `;
                        }).join('')}
                </div>
                <div class="export-actions">
                    <button onclick="stepFaceMapper.exportSelectedGroups()" class="export-btn">Export STL</button>
                    <button onclick="stepFaceMapper.closeExportDialog()" class="cancel-btn">Cancel</button>
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
        
        // Export each STEP face as STL triangles
        faceSet.forEach(stepFaceId => {
            const faceMesh = this.faceMeshes.get(stepFaceId);
            if (!faceMesh) return;
            
            const geometry = faceMesh.geometry;
            const positionAttribute = geometry.getAttribute('position');
            
            // Export all triangles of this STEP face
            for (let i = 0; i < positionAttribute.count; i += 3) {
                // Get triangle vertices
                const v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                const v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 1);
                const v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i + 2);
                
                // Apply transformation matrix
                v1.applyMatrix4(faceMesh.matrix);
                v2.applyMatrix4(faceMesh.matrix);
                v3.applyMatrix4(faceMesh.matrix);
                
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
        link.download = `${groupName}_step_faces.stl`;
        link.click();
        URL.revokeObjectURL(url);
        
        console.log(`📦 Exported ${groupName}_step_faces.stl with ${faceSet.size} STEP faces`);
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
        this.clearMappings();
        
        const panel = document.getElementById('groupsPanel');
        if (panel) panel.remove();
        
        const dialog = document.querySelector('.export-dialog');
        if (dialog) dialog.remove();
    }
}

// Export for global access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StepFaceMapper;
}