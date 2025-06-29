#!/usr/bin/env python3
"""
Lean Python STEP file processor using PythonOCC
Auto-exports complete models to STL format and creates bounding boxes
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import os
import tempfile
import time
import json
import mimetypes
import base64
from werkzeug.utils import secure_filename
from datetime import datetime
import threading

# Core PythonOCC imports
try:
    from OCC.Core.STEPControl import STEPControl_Reader
    from OCC.Core.IGESControl import IGESControl_Reader
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_VERTEX
    from OCC.Core.BRep import BRep_Tool
    from OCC.Core.TopLoc import TopLoc_Location
    from OCC.Core.Poly import Poly_Triangulation
    from OCC.Core.gp import gp_Pnt
    from OCC.Core.TopoDS import topods
    from OCC.Core.Bnd import Bnd_Box
    from OCC.Core.BRepBndLib import brepbndlib_Add
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCC.Core.gp import gp_Vec
    print("✅ Core PythonOCC modules loaded")
except ImportError as e:
    print(f"❌ Failed to import PythonOCC: {e}")
    exit(1)

# STL export module
try:
    from OCC.Extend.DataExchange import write_stl_file
    STL_EXPORT_AVAILABLE = True
    print("✅ STL export available")
except ImportError:
    STL_EXPORT_AVAILABLE = False
    print("⚠️ OCC.Extend.DataExchange not available")

# Create Flask app
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app, origins=["*"], methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["*"])

# Configuration
UPLOAD_FOLDER = 'temp'
STL_OUTPUT_FOLDER = 'stl_files'  # Single directory for all STL files
ALLOWED_EXTENSIONS = {'.step', '.stp', '.iges', '.igs'}

# Ensure directories exist
for folder in [UPLOAD_FOLDER, STL_OUTPUT_FOLDER]:
    os.makedirs(folder, exist_ok=True)

def allowed_file(filename):
    """Check if file extension is allowed"""
    return any(filename.lower().endswith(ext) for ext in ALLOWED_EXTENSIONS)

def read_cad_file(file_path):
    """Read STEP or IGES file"""
    file_ext = os.path.splitext(file_path)[1].lower()
    
    if file_ext in ['.step', '.stp']:
        reader = STEPControl_Reader()
        status = reader.ReadFile(file_path)
        if status != 1:
            raise Exception(f"Failed to read STEP file: {file_path}")
        reader.TransferRoots()
        return reader.OneShape()
    
    elif file_ext in ['.iges', '.igs']:
        reader = IGESControl_Reader()
        status = reader.ReadFile(file_path)
        if status != 1:
            raise Exception(f"Failed to read IGES file: {file_path}")
        reader.TransferRoots()
        return reader.OneShape()
    
    else:
        raise Exception(f"Unsupported file format: {file_ext}")

def create_bounding_box(shape, wall_thickness=2.0):
    """Create a hollow bounding box around the given shape using PythonOCC"""
    try:
        # Get bounding box
        bbox = Bnd_Box()
        brepbndlib_Add(shape, bbox)
        
        xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
        
        # Calculate dimensions and center
        length = xmax - xmin
        width = ymax - ymin
        height = zmax - zmin
        
        print(f"📏 Model dimensions: {length:.1f} x {width:.1f} x {height:.1f} mm")
        
        # Create outer box
        outer_box = BRepPrimAPI_MakeBox(
            gp_Pnt(xmin, ymin, zmin),
            gp_Pnt(xmax, ymax, zmax)
        ).Shape()
        
        # Create inner box (smaller by wall thickness on all sides)
        inner_xmin = xmin + wall_thickness
        inner_ymin = ymin + wall_thickness
        inner_zmin = zmin + wall_thickness
        inner_xmax = xmax - wall_thickness
        inner_ymax = ymax - wall_thickness
        inner_zmax = zmax - wall_thickness
        
        # Ensure inner box is valid (not inverted)
        if (inner_xmax > inner_xmin and 
            inner_ymax > inner_ymin and 
            inner_zmax > inner_zmin):
            
            inner_box = BRepPrimAPI_MakeBox(
                gp_Pnt(inner_xmin, inner_ymin, inner_zmin),
                gp_Pnt(inner_xmax, inner_ymax, inner_zmax)
            ).Shape()
            
            # Create hollow box by cutting inner from outer
            hollow_box = BRepAlgoAPI_Cut(outer_box, inner_box).Shape()
            
        else:
            # If wall thickness is too large, just use solid box
            print(f"⚠️ Wall thickness too large, creating solid box")
            hollow_box = outer_box
        
        return hollow_box
        
    except Exception as e:
        print(f"❌ Bounding box creation failed: {e}")
        raise e

def export_stl(shape, output_path):
    """Export shape to STL format"""
    try:
        if STL_EXPORT_AVAILABLE:
            write_stl_file(
                shape, 
                output_path,
                mode="ascii",
                linear_deflection=0.1,
                angular_deflection=0.1
            )
            print(f"✅ STL exported: {output_path}")
            return True
        else:
            print("❌ STL export not available")
            return False
            
    except Exception as e:
        print(f"❌ STL export failed: {e}")
        return False

def auto_export_with_bounding_box(shape, filename):
    """Auto-export full model and bounding box to STL in background"""
    def export_worker():
        try:
            # Ensure the output directory exists
            os.makedirs(STL_OUTPUT_FOLDER, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            base_name = os.path.splitext(filename)[0]
            
            # Export full model
            full_model_filename = f"{base_name}_{timestamp}_full.stl"
            full_model_path = os.path.join(STL_OUTPUT_FOLDER, full_model_filename)
            
            # Export bounding box
            bbox_filename = f"{base_name}_{timestamp}_bbox.stl"
            bbox_path = os.path.join(STL_OUTPUT_FOLDER, bbox_filename)
            
            print(f"📂 Output directory: {STL_OUTPUT_FOLDER}")
            print(f"📂 Directory exists: {os.path.exists(STL_OUTPUT_FOLDER)}")
            print(f"📄 Exporting to: {full_model_path}")
            print(f"📦 Exporting to: {bbox_path}")
            
            # Create bounding box
            bbox_shape = create_bounding_box(shape, wall_thickness=2.0)
            
            # Export both files
            full_model_success = export_stl(shape, full_model_path)
            bbox_success = export_stl(bbox_shape, bbox_path)
            
            if full_model_success and bbox_success:
                print(f"✅ Auto-export complete:")
                print(f"   📄 Full model: {full_model_filename}")
                print(f"   📦 Bounding box: {bbox_filename}")
            else:
                print(f"❌ Auto-export failed for: {filename}")
                
        except Exception as e:
            print(f"❌ Auto-export error: {e}")
            import traceback
            traceback.print_exc()
    
    # Run in background
    threading.Thread(target=export_worker, daemon=True).start()

def extract_mesh_data(shape):
    """Extract mesh data from shape for face mapping"""
    vertices = []
    triangles = []
    faces_data = []
    vertex_count = 0
    
    # Mesh the shape
    mesh = BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5)
    mesh.Perform()
    
    if not mesh.IsDone():
        raise Exception("Meshing failed")
    
    # Process faces
    face_explorer = TopExp_Explorer(shape, TopAbs_FACE)
    face_index = 0
    
    while face_explorer.More():
        face = topods.Face(face_explorer.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation(face, location)
        
        if triangulation:
            transform = location.Transformation()
            face_vertices = []
            face_vertex_indices = []
            
            # Extract vertices
            for i in range(triangulation.NbNodes()):
                pnt = triangulation.Node(i + 1)
                pnt.Transform(transform)
                vertex_coords = [pnt.X(), pnt.Y(), pnt.Z()]
                face_vertices.append(vertex_coords)
                vertices.append(vertex_coords)
                face_vertex_indices.append(vertex_count + i)
            
            # Extract triangles
            face_triangle_indices = []
            for i in range(triangulation.NbTriangles()):
                tri = triangulation.Triangle(i + 1)
                n1, n2, n3 = tri.Get()
                
                global_indices = [
                    vertex_count + n1 - 1,
                    vertex_count + n2 - 1,
                    vertex_count + n3 - 1
                ]
                triangles.append(global_indices)
                face_triangle_indices.append(len(triangles) - 1)
            
            # Calculate face properties
            face_center = [sum(v[i] for v in face_vertices)/len(face_vertices) for i in range(3)]
            
            face_info = {
                'id': f'face_{face_index}',
                'faceIndex': face_index,
                'triangleIndices': face_triangle_indices,
                'vertexIndices': face_vertex_indices,
                'center': face_center,
                'vertexCount': len(face_vertices),
                'triangleCount': len(face_triangle_indices),
                'vertices': face_vertices
            }
            
            faces_data.append(face_info)
            vertex_count += len(face_vertices)
        
        face_explorer.Next()
        face_index += 1
    
    return vertices, triangles, faces_data

def calculate_normals(vertices, triangles):
    """Calculate vertex normals"""
    import math
    
    normals = [[0.0, 0.0, 0.0] for _ in vertices]
    
    for triangle in triangles:
        i1, i2, i3 = triangle
        v1, v2, v3 = vertices[i1], vertices[i2], vertices[i3]
        
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
    
    # Normalize
    for i, normal in enumerate(normals):
        length = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2)
        if length > 0:
            normals[i] = [normal[0]/length, normal[1]/length, normal[2]/length]
        else:
            normals[i] = [0.0, 0.0, 1.0]
    
    return normals

def process_step_file(file_path):
    """Process STEP/IGES file and auto-export with bounding box"""
    print(f"Processing: {file_path}")
    
    try:
        shape = read_cad_file(file_path)
        print("✅ File loaded")
        
        # Auto-export full model and bounding box in background
        filename = os.path.basename(file_path)
        auto_export_with_bounding_box(shape, filename)
        
        # Extract mesh for face selection
        vertices, triangles, faces_data = extract_mesh_data(shape)
        vertex_normals = calculate_normals(vertices, triangles)
        
        print(f"✅ Processed: {len(vertices)} vertices, {len(triangles)} triangles, {len(faces_data)} faces")
        
        mesh_data = {
            "vertices": [coord for vertex in vertices for coord in vertex],
            "indices": [idx for triangle in triangles for idx in triangle],
            "normals": [coord for normal in vertex_normals for coord in normal],
            "faces": faces_data,
            "vertexCount": len(vertices),
            "triangleCount": len(triangles),
            "faceCount": len(faces_data)
        }
        
        return [mesh_data]
        
    except Exception as e:
        print(f"❌ Processing failed: {e}")
        raise e

# ========================
# API ENDPOINTS
# ========================

@app.route('/api/health', methods=['GET'])
def api_health():
    """Health check"""
    return jsonify({
        'status': 'ok',
        'server': 'Lean PythonOCC with STL Auto Export + Bounding Boxes',
        'stl_export_available': STL_EXPORT_AVAILABLE
    })

@app.route('/api/store-stl', methods=['POST'])
def store_stl():
    """Store face selection STL"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data'}), 400
        
        project_id = data.get('projectId')
        group_name = data.get('groupName')
        stl_data = data.get('stlData')
        
        if not all([project_id, group_name, stl_data]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400

        # Ensure the output directory exists
        os.makedirs(STL_OUTPUT_FOLDER, exist_ok=True)
        
        binary_data = base64.b64decode(stl_data)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{project_id}_{group_name}_{timestamp}_group.stl"
        file_path = os.path.join(STL_OUTPUT_FOLDER, filename)
        
        print(f"📁 Attempting to save: {file_path}")
        print(f"📂 Directory exists: {os.path.exists(STL_OUTPUT_FOLDER)}")
        
        with open(file_path, 'wb') as f:
            f.write(binary_data)

        print(f"✅ Saved face group STL: {file_path}")

        return jsonify({
            'success': True,
            'filePath': file_path,
            'fileSize': len(binary_data),
            'projectId': project_id,
            'groupName': group_name
        })
        
    except Exception as e:
        print(f"❌ Store STL error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/list-stl-files', methods=['GET'])
def list_stl_files():
    """List all STL files in the output directory"""
    try:
        if not os.path.exists(STL_OUTPUT_FOLDER):
            return jsonify({'success': True, 'files': []})
        
        files = []
        for filename in os.listdir(STL_OUTPUT_FOLDER):
            if filename.endswith('.stl'):
                file_path = os.path.join(STL_OUTPUT_FOLDER, filename)
                file_stats = os.stat(file_path)
                
                # Determine file type based on filename
                if '_full.stl' in filename:
                    file_type = 'full_model'
                elif '_bbox.stl' in filename:
                    file_type = 'bounding_box'
                elif '_group.stl' in filename:
                    file_type = 'face_group'
                else:
                    file_type = 'unknown'
                
                files.append({
                    'filename': filename,
                    'type': file_type,
                    'size': file_stats.st_size,
                    'created': datetime.fromtimestamp(file_stats.st_ctime).isoformat()
                })
        
        return jsonify({
            'success': True,
            'files': sorted(files, key=lambda x: x['created'], reverse=True)
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/download-stl/<filename>', methods=['GET'])
def download_stl(filename):
    """Download any STL file"""
    try:
        file_path = os.path.join(STL_OUTPUT_FOLDER, filename)
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(file_path, as_attachment=True, download_name=filename)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ========================
# MAIN ENDPOINTS
# ========================

@app.route('/')
def index():
    """Serve main HTML"""
    html_files = ['index.html', 'index1.html']
    
    for html_file in html_files:
        if os.path.exists(html_file):
            return send_file(html_file)
    
    return f'''
    <h1>🐍 Lean STEP Processor</h1>
    <p>✅ Server running - Auto STL export + Bounding Boxes enabled</p>
    <p>📁 All STL files: {STL_OUTPUT_FOLDER}/</p>
    <p>⚠️ No HTML file found. Expected: {html_files}</p>
    '''

@app.route('/<path:filename>')
def static_files(filename):
    """Serve static files"""
    try:
        if not os.path.exists(filename) or '..' in filename:
            return "File not found", 404
        return send_file(filename)
    except Exception as e:
        return f"Error: {e}", 500

@app.route('/process-step', methods=['POST'])
def process_step():
    """Main STEP processing endpoint with auto STL export and bounding box creation"""
    if 'stepFile' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['stepFile']
    if not file.filename or not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file'}), 400
    
    filename = secure_filename(file.filename)
    file_path = os.path.join(UPLOAD_FOLDER, f"{int(time.time())}-{filename}")
    
    try:
        file.save(file_path)
        print(f"📁 Processing: {filename}")
        
        meshes = process_step_file(file_path)
        
        response = {
            'success': True,
            'data': {
                'meshes': meshes,
                'statistics': {
                    'totalVertices': sum(m['vertexCount'] for m in meshes),
                    'totalTriangles': sum(m['triangleCount'] for m in meshes),
                    'totalFaces': sum(m['faceCount'] for m in meshes),
                    'fileName': filename
                }
            }
        }
        
        return jsonify(response)
        
    except Exception as e:
        print(f"❌ Processing failed: {e}")
        return jsonify({'error': str(e)}), 500
        
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

if __name__ == '__main__':
    print("🚀 Starting Lean STEP Processor with STL Auto Export + Bounding Boxes")
    print(f"📂 STL Output Directory: {STL_OUTPUT_FOLDER}")
    print(f"✅ STL Export: {'Available' if STL_EXPORT_AVAILABLE else 'Not Available'}")
    print("🌐 http://localhost:3000")
    
    app.run(host='0.0.0.0', port=3000, debug=True)