#!/usr/bin/env python3
"""
Python STEP file processor using PythonOCC
Equivalent to your Node.js OpenCascade.js server
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import tempfile
import time
import json
from werkzeug.utils import secure_filename

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

app = Flask(__name__)
CORS(app, origins=["*"], methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])  # Enable CORS for all routes

# Configuration
UPLOAD_FOLDER = 'temp'
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {'.step', '.stp', '.iges', '.igs'}

# Ensure upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

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

def extract_mesh_data(shape):
    """Extract mesh data from OpenCASCADE shape"""
    vertices = []
    triangles = []
    vertex_count = 0
    
    # Mesh the shape with a reasonable tolerance
    mesh = BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5)
    mesh.Perform()
    
    if not mesh.IsDone():
        raise Exception("Meshing failed")
    
    # Iterate through all faces
    face_explorer = TopExp_Explorer(shape, TopAbs_FACE)
    
    while face_explorer.More():
        face = topods.Face(face_explorer.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation(face, location)
        
        if triangulation:
            # Get transformation
            transform = location.Transformation()
            
            # Extract vertices - updated API
            face_vertices = []
            
            # Try different methods to access nodes
            try:
                # Method 1: Direct node access (newer API)
                for i in range(triangulation.NbNodes()):
                    pnt = triangulation.Node(i + 1)  # 1-based indexing
                    # Apply transformation
                    pnt.Transform(transform)
                    face_vertices.append([pnt.X(), pnt.Y(), pnt.Z()])
                    vertices.append([pnt.X(), pnt.Y(), pnt.Z()])
            except:
                try:
                    # Method 2: Using array access
                    nodes = triangulation.InternalNodes()
                    for i in range(1, triangulation.NbNodes() + 1):
                        pnt = nodes.Value(i)
                        pnt.Transform(transform)
                        face_vertices.append([pnt.X(), pnt.Y(), pnt.Z()])
                        vertices.append([pnt.X(), pnt.Y(), pnt.Z()])
                except:
                    print("Warning: Could not extract vertices from triangulation")
                    continue
            
            # Extract triangles - updated API
            try:
                # Method 1: Direct triangle access
                for i in range(triangulation.NbTriangles()):
                    tri = triangulation.Triangle(i + 1)  # 1-based indexing
                    n1, n2, n3 = tri.Get()
                    
                    # Adjust indices to global vertex array (0-based)
                    triangles.append([
                        vertex_count + n1 - 1,  # Convert to 0-based
                        vertex_count + n2 - 1,
                        vertex_count + n3 - 1
                    ])
            except:
                try:
                    # Method 2: Using array access
                    tris = triangulation.InternalTriangles()
                    for i in range(1, triangulation.NbTriangles() + 1):
                        tri = tris.Value(i)
                        n1, n2, n3 = tri.Get()
                        
                        triangles.append([
                            vertex_count + n1 - 1,
                            vertex_count + n2 - 1,
                            vertex_count + n3 - 1
                        ])
                except:
                    print("Warning: Could not extract triangles from triangulation")
                    continue
            
            vertex_count += len(face_vertices)
        
        face_explorer.Next()
    
    return vertices, triangles

def calculate_normals(vertices, triangles):
    """Calculate vertex normals from triangle data"""
    import math
    
    # Initialize normals array
    normals = [[0.0, 0.0, 0.0] for _ in vertices]
    
    # Calculate face normals and accumulate to vertices
    for triangle in triangles:
        i1, i2, i3 = triangle
        
        # Get triangle vertices
        v1 = vertices[i1]
        v2 = vertices[i2]
        v3 = vertices[i3]
        
        # Calculate edge vectors
        edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]]
        edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]]
        
        # Calculate face normal (cross product)
        normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
        ]
        
        # Normalize
        length = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2)
        if length > 0:
            normal = [normal[0]/length, normal[1]/length, normal[2]/length]
        
        # Add to each vertex of the triangle
        for idx in triangle:
            normals[idx][0] += normal[0]
            normals[idx][1] += normal[1]
            normals[idx][2] += normal[2]
    
    # Normalize accumulated normals
    for i, normal in enumerate(normals):
        length = math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2)
        if length > 0:
            normals[i] = [normal[0]/length, normal[1]/length, normal[2]/length]
        else:
            normals[i] = [0.0, 0.0, 1.0]  # Default normal
    
    return normals

def process_step_file(file_path):
    """Process STEP/IGES file and extract mesh data"""
    print(f"Processing file: {file_path}")
    
    try:
        # Determine file type and read accordingly
        if file_path.lower().endswith(('.step', '.stp')):
            shape = read_step_file(file_path)
        elif file_path.lower().endswith(('.iges', '.igs')):
            shape = read_iges_file(file_path)
        else:
            raise Exception("Unsupported file format")
        
        print("File imported successfully")
        
        # Extract mesh data
        vertices, triangles = extract_mesh_data(shape)
        
        print(f"Tessellation complete: {len(vertices)} vertices, {len(triangles)} triangles")
        
        # Calculate normals
        vertex_normals = calculate_normals(vertices, triangles)
        
        # Create mesh data structure matching your Node.js format
        mesh_data = {
            "vertices": [coord for vertex in vertices for coord in vertex],  # Flatten to [x,y,z,x,y,z,...]
            "indices": [idx for triangle in triangles for idx in triangle],  # Flatten triangle indices
            "normals": [coord for normal in vertex_normals for coord in normal],  # Flatten normals
            "faceIndex": 1,
            "vertexCount": len(vertices),
            "triangleCount": len(triangles)
        }
        
        return [mesh_data]  # Return as array to match JS format
        
    except Exception as e:
        print(f"❌ Error processing file: {e}")
        import traceback
        traceback.print_exc()
        raise e

@app.route('/test', methods=['GET'])
def test_endpoint():
    """Test endpoint to verify server is working"""
    try:
        from OCC.Core import VERSION
        occ_version = VERSION
    except:
        occ_version = "Unknown"
    
    return jsonify({
        'message': 'Python PythonOCC STEP server is working',
        'pythonocc_version': occ_version,
        'python_version': f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
        'server_type': 'Python Flask + PythonOCC'
    })

@app.route('/process-step', methods=['POST'])
def process_step():
    """Main endpoint for processing STEP files"""
    print('\n=== STEP Processing Request (Python/PythonOCC) ===')
    
    # Check if file was uploaded
    if 'stepFile' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    
    file = request.files['stepFile']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Only STEP and IGES files are allowed.'}), 400
    
    # Save uploaded file
    filename = secure_filename(file.filename)
    timestamp = str(int(time.time()))
    unique_filename = f"{timestamp}-{filename}"
    file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
    
    try:
        file.save(file_path)
        file_size = os.path.getsize(file_path)
        print(f"File: {filename}")
        print(f"Size: {file_size} bytes")
        
        # Process the STEP file
        print("Processing file with PythonOCC...")
        meshes = process_step_file(file_path)
        
        # Calculate statistics
        total_vertices = sum(mesh['vertexCount'] for mesh in meshes)
        total_triangles = sum(mesh['triangleCount'] for mesh in meshes)
        
        print(f"✅ Processing complete!")
        print(f"Meshes: {len(meshes)}")
        print(f"Vertices: {total_vertices}")
        print(f"Triangles: {total_triangles}\n")
        
        # Return response matching Node.js format
        response = {
            'success': True,
            'data': {
                'meshes': meshes,
                'faces': len(meshes),
                'statistics': {
                    'totalVertices': total_vertices,
                    'totalTriangles': total_triangles,
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
        # Clean up uploaded file
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print("Cleaned up uploaded file")
        except Exception as cleanup_error:
            print(f"Error cleaning up file: {cleanup_error}")

@app.route('/')
def index():
    """Serve the frontend HTML file"""
    try:
        return send_from_directory('.', 'index1.html')
    except:
        # Fallback if HTML file not found
        try:
            from OCC.Core import VERSION
            occ_version = VERSION
        except:
            occ_version = "Unknown"
        
        return f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Python STEP Processor</title>
        </head>
        <body>
            <h1>🐍 Python STEP File Processor</h1>
            <p>Server is running with PythonOCC {occ_version}</p>
            <p><strong>⚠️ Frontend file 'index1.html' not found!</strong></p>
            <p>Please save the frontend HTML file as 'index1.html' in the same directory as this server.</p>
            <p>Upload STEP files to <code>/process-step</code> endpoint</p>
            <p>Test server at <code>/test</code> endpoint</p>
        </body>
        </html>
        '''

@app.route('/index1.html')
def serve_frontend():
    """Serve the frontend HTML file"""
    return send_from_directory('.', 'index1.html')

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'server': 'Python Flask + PythonOCC'
    })

if __name__ == '__main__':
    print("🚀 Starting Python STEP processing server...")
    try:
        from OCC.Core import VERSION
        print(f"📦 Using PythonOCC version: {VERSION}")
    except:
        print("📦 PythonOCC version: Unknown")
    print("🌐 Server will run on http://localhost:3000")
    print("📊 Ready to process STEP files server-side!")
    
    app.run(host='0.0.0.0', port=3000, debug=True)