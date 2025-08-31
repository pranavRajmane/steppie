#!/usr/bin/env python3
"""
Enhanced Python STEP file processor using PythonOCC
Now includes STL export storage functionality
"""

from flask import Flask, request, jsonify, send_from_directory, send_file, render_template
from flask_cors import CORS
import os
import tempfile
import time
import json
import mimetypes
import uuid
import base64
from werkzeug.utils import secure_filename
from datetime import datetime

# PythonOCC imports
from OCC.Core.STEPControl import STEPControl_Reader
from OCC.Core.IGESControl import IGESControl_Reader
from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_VERTEX
from OCC.Core.BRep import BRep_Tool
from OCC.Core.TopLoc import TopLoc_Location
from OCC.Core.Poly import Poly_Triangulation
from OCC.Core.TColgp import TColgp_Array1OfPnt
from OCC.Core.gp import gp_Pnt
from OCC.Core.TopoDS import topods
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox 
from OCC.Core.BRepBndLib import brepbndlib
from OCC.Core.Bnd import Bnd_Box
from OCC.Core.gp import gp_Trsf, gp_Vec
# Create Flask app with static file support
app = Flask(__name__)
CORS(app, origins=["*"], methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["*"])

# Configuration
UPLOAD_FOLDER = 'temp'
STL_STORAGE_FOLDER = 'stl_storage'
EXPORTS_FOLDER = 'exports'
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {'.step', '.stp', '.iges', '.igs'}

# In-memory storage for CAD objects
scene_objects = {}

# Ensure directories exist
for folder in [UPLOAD_FOLDER, STL_STORAGE_FOLDER, EXPORTS_FOLDER]:
    os.makedirs(folder, exist_ok=True)

def allowed_file(filename):
    """Check if file extension is allowed"""
    return any(filename.lower().endswith(ext) for ext in ALLOWED_EXTENSIONS)

def read_step_file(file_path):
    """Read STEP file using PythonOCC"""
    step_reader = STEPControl_Reader()
    status = step_reader.ReadFile(file_path)
    
    if status != 1:  # IFSelect_RetDone
        raise Exception(f"Failed to read STEP file: {file_path}")
    
    # Transfer shapes
    step_reader.TransferRoots()
    shape = step_reader.OneShape()
    
    return shape

def read_iges_file(file_path):
    """Read IGES file using PythonOCC"""
    iges_reader = IGESControl_Reader()
    status = iges_reader.ReadFile(file_path)
    
    if status != 1:  # IFSelect_RetDone
        raise Exception(f"Failed to read IGES file: {file_path}")
    
    # Transfer shapes
    iges_reader.TransferRoots()
    shape = iges_reader.OneShape()
    
    return shape

# In occserver.py

def extract_mesh_data(shape, shape_id=None):
    """Extract mesh data using an indexed geometry approach for correctness."""
    mesh = BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5)
    mesh.Perform()
    
    if not mesh.IsDone():
        raise Exception("Meshing failed")

    # Global lists for the entire shape
    global_vertices = []
    global_indices = []
    faces_data = []
    
    face_explorer = TopExp_Explorer(shape, TopAbs_FACE)
    face_index = 0
    
    while face_explorer.More():
        face = topods.Face(face_explorer.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation(face, location)
        
        if triangulation:
            transform = location.Transformation()
            
            # Per-face lists for indexed geometry
            face_vertices = []
            face_indices = []
            vertex_map = {}  # Maps original node index to new local index
            
            for i in range(triangulation.NbTriangles()):
                triangle = triangulation.Triangle(i + 1)
                n1, n2, n3 = triangle.Get()
                
                # Process each vertex of the triangle
                for node_index in [n1, n2, n3]:
                    if node_index not in vertex_map:
                        new_local_index = len(face_vertices)
                        vertex_map[node_index] = new_local_index
                        
                        # --- THIS IS THE FIX ---
                        # Get the node directly by its index instead of from a pre-fetched array
                        pnt = triangulation.Node(node_index)
                        pnt.Transform(transform)
                        
                        face_vertices.append([pnt.X(), pnt.Y(), pnt.Z()])
                    
                    face_indices.append(vertex_map[node_index])

            # Store the indexed geometry for this face
            face_info = {
                'id': f'face_{face_index}',
                'vertices': face_vertices,
                'indices': face_indices,
                'vertexCount': len(face_vertices),
                'triangleCount': len(face_indices) // 3
            }
            faces_data.append(face_info)

            # Update global lists for the entire shape
            offset = len(global_vertices)
            global_vertices.extend(face_vertices)
            global_indices.extend([i + offset for i in face_indices])

        face_explorer.Next()
        face_index += 1

    flat_vertices = [coord for vertex in global_vertices for coord in vertex]

    return {
        "id": shape_id,
        "vertices": flat_vertices,
        "indices": global_indices,
        "faces": faces_data,
        "vertexCount": len(global_vertices),
        "triangleCount": len(global_indices) // 3,
        "faceCount": len(faces_data)
    }

def calculate_face_area_accurate(vertices, triangles):
    """Calculate accurate face area from triangles"""
    total_area = 0.0
    
    for triangle in triangles:
        if len(vertices) >= 3:
            v1 = vertices[0] if len(vertices) > 0 else [0, 0, 0]
            v2 = vertices[1] if len(vertices) > 1 else [0, 0, 0]
            v3 = vertices[2] if len(vertices) > 2 else [0, 0, 0]
            
            edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]]
            edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]]
            
            cross = [
                edge1[1] * edge2[2] - edge1[2] * edge2[1],
                edge1[2] * edge2[0] - edge1[0] * edge2[2],
                edge1[0] * edge2[1] - edge1[1] * edge2[0]
            ]
            
            magnitude = (cross[0]**2 + cross[1]**2 + cross[2]**2)**0.5
            total_area += magnitude * 0.5
    
    return total_area

def calculate_face_center(vertices):
    """Calculate the center point of a face"""
    if not vertices:
        return [0.0, 0.0, 0.0]
    
    center = [0.0, 0.0, 0.0]
    for vertex in vertices:
        center[0] += vertex[0]
        center[1] += vertex[1]
        center[2] += vertex[2]
    
    vertex_count = len(vertices)
    return [center[0]/vertex_count, center[1]/vertex_count, center[2]/vertex_count]

def calculate_face_normal_accurate(vertices, triangles):
    """Calculate accurate face normal from triangles"""
    if len(vertices) < 3:
        return [0.0, 0.0, 1.0]
    
    v1 = vertices[0]
    v2 = vertices[1] if len(vertices) > 1 else vertices[0]
    v3 = vertices[2] if len(vertices) > 2 else vertices[0]
    
    edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]]
    edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]]
    
    normal = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0]
    ]
    
    length = (normal[0]**2 + normal[1]**2 + normal[2]**2)**0.5
    if length > 0:
        normal = [normal[0]/length, normal[1]/length, normal[2]/length]
    else:
        normal = [0.0, 0.0, 1.0]
    
    return normal

def calculate_face_bounds(vertices):
    """Calculate the bounding box of a face"""
    if not vertices:
        return {'min': [0, 0, 0], 'max': [0, 0, 0]}
    
    min_coords = [float('inf'), float('inf'), float('inf')]
    max_coords = [float('-inf'), float('-inf'), float('-inf')]
    
    for vertex in vertices:
        for i in range(3):
            min_coords[i] = min(min_coords[i], vertex[i])
            max_coords[i] = max(max_coords[i], vertex[i])
    
    return {'min': min_coords, 'max': max_coords}

def calculate_normals(vertices, triangles):
    """Calculate vertex normals from triangle data"""
    import math
    
    normals = [[0.0, 0.0, 0.0] for _ in vertices]
    
    for triangle in triangles:
        i1, i2, i3 = triangle
        
        v1 = vertices[i1]
        v2 = vertices[i2]
        v3 = vertices[i3]
        
        edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]]
        edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]]
        
        normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
        ]
        
        length = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2)
        if length > 0:
            normal = [normal[0]/length, normal[1]/length, normal[2]/length]
        
        for idx in triangle:
            normals[idx][0] += normal[0]
            normals[idx][1] += normal[1]
            normals[idx][2] += normal[2]
    
    for i, normal in enumerate(normals):
        length = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2)
        if length > 0:
            normals[i] = [normal[0]/length, normal[1]/length, normal[2]/length]
        else:
            normals[i] = [0.0, 0.0, 1.0]
    
    return normals

# In occserver.py

def process_step_file(file_path):
    """Process STEP/IGES file and extract mesh data with face mapping"""
    print(f"Processing file: {file_path}")

    try:
        if file_path.lower().endswith(('.step', '.stp')):
            shape = read_step_file(file_path)
        elif file_path.lower().endswith(('.iges', '.igs')):
            shape = read_iges_file(file_path)
        else:
            raise Exception("Unsupported file format")

        print("File imported successfully")

        # --- START: NEW CENTERING LOGIC ---
        bbox = Bnd_Box()
        brepbndlib.Add(shape, bbox)

        if bbox.IsVoid():
            raise Exception("Bounding box is void, cannot center shape.")

        # Get bounding box dimensions and center
        xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
        center_x = (xmin + xmax) / 2.0
        center_y = (ymin + ymax) / 2.0
        center_z = (zmin + zmax) / 2.0

        # Create a translation vector to move the shape's center to the origin
        translation_vector = gp_Vec(-center_x, -center_y, -center_z)
        transform = gp_Trsf()
        transform.SetTranslation(translation_vector)

        # Apply the transformation
        shape.Move(TopLoc_Location(transform))
        print(f"Shape centered. Moved by {-center_x:.2f}, {-center_y:.2f}, {-center_z:.2f}")
        # --- END: NEW CENTERING LOGIC ---

        # Generate a unique ID and store the shape in our scene dictionary
        shape_id = uuid.uuid4().hex
        scene_objects[shape_id] = shape
        print(f"Stored shape with ID: {shape_id}")

        mesh_data = extract_mesh_data(shape, shape_id)

        print(f"Tessellation complete: {mesh_data['vertexCount']} vertices, {mesh_data['triangleCount']} triangles, {mesh_data['faceCount']} faces")

        return [mesh_data]

    except Exception as e:
        print(f"❌ Error processing file: {e}")
        import traceback
        traceback.print_exc()
        raise e
# ========================
# STL EXPORT ENDPOINTS
# ========================

@app.route('/api/create/box', methods=['POST'])
def create_box():
    """Create a box primitive."""
    try:
        data = request.get_json() or {}
        width = data.get('width', 10)
        height = data.get('height', 10)
        depth = data.get('depth', 10)

        print(f"Creating box with dimensions: {width}x{height}x{depth}")

        # Create the box shape using PythonOCC
        box_shape = BRepPrimAPI_MakeBox(width, height, depth).Shape()

        # Generate a unique ID and store the shape
        shape_id = uuid.uuid4().hex
        scene_objects[shape_id] = box_shape
        print(f"Stored new box shape with ID: {shape_id}")

        # Extract mesh data for sending to the client
        mesh_data = extract_mesh_data(box_shape, shape_id)

        return jsonify({
            'success': True,
            'message': 'Box created successfully',
            'mesh': mesh_data
        })

    except Exception as e:
        print(f"❌ Error in create_box: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    


@app.route('/api/health', methods=['GET'])
def api_health():
    """Health check endpoint for API"""
    return jsonify({
        'status': 'ok', 
        'message': 'STL storage server is running',
        'timestamp': time.time(),
        'server': 'Python Flask + PythonOCC with STL Export'
    })

@app.route('/api/store-stl', methods=['POST'])
def store_stl():
    """Store STL data with project organization"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data received'
            }), 400
        
        project_id = data.get('projectId')
        group_name = data.get('groupName')
        stl_data = data.get('stlData')
        metadata = data.get('metadata', {})
        
        if not project_id or not group_name or not stl_data:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: projectId, groupName, stlData'
            }), 400

        # Create project directory
        project_dir = os.path.join(STL_STORAGE_FOLDER, project_id)
        os.makedirs(project_dir, exist_ok=True)

        # Decode base64 STL data
        try:
            binary_data = base64.b64decode(stl_data)
        except Exception as decode_error:
            return jsonify({
                'success': False,
                'error': f'Failed to decode base64 STL data: {str(decode_error)}'
            }), 400

        # Save STL file
        filename = f"{group_name}.stl"
        file_path = os.path.join(project_dir, filename)
        
        with open(file_path, 'wb') as f:
            f.write(binary_data)

        # Save metadata
        if metadata:
            metadata['timestamp'] = datetime.now().isoformat()
            metadata['file_size'] = len(binary_data)
            metadata_path = os.path.join(project_dir, f"{group_name}_metadata.json")
            
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

        print(f"📁 Saved STL file: {file_path} ({len(binary_data)} bytes)")

        return jsonify({
            'success': True,
            'filePath': file_path,
            'fileSize': len(binary_data),
            'projectId': project_id,
            'groupName': group_name,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as error:
        print(f"❌ Error in store_stl: {error}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            'success': False,
            'error': str(error)
        }), 500

@app.route('/api/project/<project_id>', methods=['GET'])
def get_project_status(project_id):
    """Get project status and file list"""
    try:
        project_dir = os.path.join(STL_STORAGE_FOLDER, project_id)
        
        if not os.path.exists(project_dir):
            return jsonify({
                'success': False,
                'error': 'Project not found'
            }), 404

        # Get STL files in project
        files = []
        for filename in os.listdir(project_dir):
            if filename.endswith('.stl'):
                file_path = os.path.join(project_dir, filename)
                file_stats = os.stat(file_path)
                
                # Look for corresponding metadata
                metadata_path = os.path.join(project_dir, f"{filename[:-4]}_metadata.json")
                metadata = {}
                if os.path.exists(metadata_path):
                    try:
                        with open(metadata_path, 'r') as f:
                            metadata = json.load(f)
                    except:
                        pass
                
                files.append({
                    'name': filename,
                    'size': file_stats.st_size,
                    'created': datetime.fromtimestamp(file_stats.st_ctime).isoformat(),
                    'modified': datetime.fromtimestamp(file_stats.st_mtime).isoformat(),
                    'metadata': metadata
                })

        return jsonify({
            'success': True,
            'projectId': project_id,
            'files': sorted(files, key=lambda x: x['created'], reverse=True),
            'totalFiles': len(files),
            'totalSize': sum(f['size'] for f in files)
        })
        
    except Exception as error:
        print(f"❌ Error in get_project_status: {error}")
        return jsonify({
            'success': False,
            'error': str(error)
        }), 500

@app.route('/api/save-stl', methods=['POST'])
def save_stl():
    """Simple STL save endpoint (backward compatibility)"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data received'}), 400
        
        filename = data.get('filename')
        stl_data = data.get('stlData')
        
        if not filename or not stl_data:
            return jsonify({'error': 'Missing filename or stlData'}), 400

        # Ensure exports directory exists
        os.makedirs(EXPORTS_FOLDER, exist_ok=True)
        
        # Save STL file
        output_path = os.path.join(EXPORTS_FOLDER, filename)
        
        with open(output_path, 'w') as f:
            f.write(stl_data)
        
        print(f"📁 Saved STL file: {output_path}")
        
        return jsonify({
            'success': True,
            'message': 'STL file saved on server',
            'filePath': output_path,
            'fileSize': len(stl_data.encode('utf-8'))
        })
        
    except Exception as error:
        print(f"❌ Error in save_stl: {error}")
        return jsonify({
            'success': False,
            'error': str(error)
        }), 500

@app.route('/api/list-projects', methods=['GET'])
def list_projects():
    """List all available projects"""
    try:
        if not os.path.exists(STL_STORAGE_FOLDER):
            return jsonify({
                'success': True,
                'projects': []
            })
        
        projects = []
        for project_name in os.listdir(STL_STORAGE_FOLDER):
            project_path = os.path.join(STL_STORAGE_FOLDER, project_name)
            if os.path.isdir(project_path):
                # Count STL files in project
                stl_files = [f for f in os.listdir(project_path) if f.endswith('.stl')]
                
                projects.append({
                    'projectId': project_name,
                    'fileCount': len(stl_files),
                    'created': datetime.fromtimestamp(os.path.getctime(project_path)).isoformat()
                })
        
        return jsonify({
            'success': True,
            'projects': sorted(projects, key=lambda x: x['created'], reverse=True)
        })
        
    except Exception as error:
        print(f"❌ Error in list_projects: {error}")
        return jsonify({
            'success': False,
            'error': str(error)
        }), 500

@app.route('/api/download-stl/<project_id>/<filename>', methods=['GET'])
def download_stl(project_id, filename):
    """Download an STL file"""
    try:
        project_dir = os.path.join(STL_STORAGE_FOLDER, project_id)
        file_path = os.path.join(project_dir, filename)
        
        if not os.path.exists(file_path):
            return jsonify({
                'success': False,
                'error': 'File not found'
            }), 404
        
        return send_file(file_path, as_attachment=True, download_name=filename)
        
    except Exception as error:
        print(f"❌ Error in download_stl: {error}")
        return jsonify({
            'success': False,
            'error': str(error)
        }), 500

# ========================
# ORIGINAL STEP PROCESSING ENDPOINTS
# ========================

@app.route('/')
def index():
    """Serve the main HTML file"""
    return render_template('index1.html')
    

@app.route('/test', methods=['GET'])
def test_endpoint():
    """Test endpoint to verify server is working"""
    try:
        from OCC.Core import VERSION
        occ_version = VERSION
    except:
        occ_version = "Unknown"
    
    return jsonify({
        'message': 'Enhanced Python PythonOCC STEP server with STL export is working',
        'pythonocc_version': occ_version,
        'python_version': f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
        'server_type': 'Python Flask + PythonOCC + STL Export',
        'static_files_enabled': True,
        'stl_export_enabled': True
    })

@app.route('/process-step', methods=['POST'])
def process_step():
    """Main endpoint for processing STEP files"""
    print('\n=== STEP Processing Request (Python/PythonOCC) ===')
    
    if 'stepFile' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['stepFile']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Only STEP and IGES files are allowed.'}), 400
    
    filename = secure_filename(file.filename)
    timestamp = str(int(time.time()))
    unique_filename = f"{timestamp}-{filename}"
    file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
    
    try:
        file.save(file_path)
        file_size = os.path.getsize(file_path)
        print(f"File: {filename}")
        print(f"Size: {file_size} bytes")
        
        print("Processing file with PythonOCC...")
        meshes = process_step_file(file_path)
        
        total_vertices = sum(mesh['vertexCount'] for mesh in meshes)
        total_triangles = sum(mesh['triangleCount'] for mesh in meshes)
        
        print(f"✅ Processing complete!")
        print(f"Meshes: {len(meshes)}")
        print(f"Vertices: {total_vertices}")
        print(f"Triangles: {total_triangles}\n")
        
        response = {
            'success': True,
            'data': {
                'meshes': meshes,
                'faces': sum(mesh['faceCount'] for mesh in meshes),
                'statistics': {
                    'totalVertices': total_vertices,
                    'totalTriangles': total_triangles,
                    'totalFaces': sum(mesh['faceCount'] for mesh in meshes),
                    'fileName': filename,
                    'fileSize': file_size
                }
            }
        }
        
        return jsonify(response)
        
    except Exception as e:
        print(f"❌ Processing failed: {str(e)}")
        return jsonify({
            'error': 'Failed to process STEP file',
            'details': str(e)
        }), 500
        
    finally:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print("Cleaned up uploaded file")
        except Exception as cleanup_error:
            print(f"Error cleaning up file: {cleanup_error}")

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'server': 'Python Flask + PythonOCC + STL Export',
        'stl_storage_available': True,
        'directories': {
            'upload': UPLOAD_FOLDER,
            'stl_storage': STL_STORAGE_FOLDER,
            'exports': EXPORTS_FOLDER
        },
        'files_in_directory': os.listdir('.')
    })

if __name__ == '__main__':
    print("🚀 Starting Enhanced Python STEP processing server with STL Export...")
    try:
        from OCC.Core import VERSION
        print(f"📦 Using PythonOCC version: {VERSION}")
    except:
        print("📦 PythonOCC version: Unknown")
    
    print(f"📁 Current directory: {os.getcwd()}")
    print(f"📂 Storage directories:")
    print(f"   📥 Uploads: {UPLOAD_FOLDER}")
    print(f"   📤 STL Storage: {STL_STORAGE_FOLDER}")
    print(f"   📋 Exports: {EXPORTS_FOLDER}")
    
    # List available files
    current_files = [f for f in os.listdir('.') if os.path.isfile(f)]
    print(f"📄 Available files:")
    for file in sorted(current_files):
        if file.endswith(('.html', '.js', '.css', '.json')):
            print(f"   ✅ {file}")
    
    print("\n🌐 Server will run on http://localhost:3000")
    print("📊 Features enabled:")
    print("   🔧 STEP file processing with face mapping")
    print("   🎯 Individual face mesh creation")
    print("   📤 STL export with project organization")
    print("   💾 File storage and download")
    print("   🔍 Project management API")
    
    app.run(host='0.0.0.0', port=3000, debug=True)