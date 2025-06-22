#!/usr/bin/env python3
"""
Python STEP file processor using PythonOCC
Equivalent to your Node.js OpenCascade.js server
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import os
import tempfile
import time
import json
import mimetypes
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

# Create Flask app with static file support
app = Flask(__name__, static_folder='.', static_url_path='')
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
    """Extract mesh data from OpenCASCADE shape with face mapping"""
    vertices = []
    triangles = []
    faces_data = []  # Store face information for mapping
    vertex_count = 0
    
    # Mesh the shape with a reasonable tolerance
    mesh = BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5)
    mesh.Perform()
    
    if not mesh.IsDone():
        raise Exception("Meshing failed")
    
    # Iterate through all faces and maintain face information
    face_explorer = TopExp_Explorer(shape, TopAbs_FACE)
    face_index = 0
    
    while face_explorer.More():
        face = topods.Face(face_explorer.Current())
        location = TopLoc_Location()
        triangulation = BRep_Tool.Triangulation(face, location)
        
        if triangulation:
            # Get transformation
            transform = location.Transformation()
            
            # Store face start indices
            face_start_vertex = vertex_count
            face_start_triangle = len(triangles)
            
            # Extract vertices for this face
            face_vertices = []
            face_vertex_normals = []
            
            try:
                # Method 1: Direct node access (newer API)
                for i in range(triangulation.NbNodes()):
                    pnt = triangulation.Node(i + 1)  # 1-based indexing
                    # Apply transformation
                    pnt.Transform(transform)
                    vertex_coords = [pnt.X(), pnt.Y(), pnt.Z()]
                    face_vertices.append(vertex_coords)
                    vertices.append(vertex_coords)
                    
                    # Calculate vertex normal (simplified)
                    face_vertex_normals.extend([0.0, 0.0, 1.0])  # Will be computed properly
                    
            except:
                try:
                    # Method 2: Using array access
                    nodes = triangulation.InternalNodes()
                    for i in range(1, triangulation.NbNodes() + 1):
                        pnt = nodes.Value(i)
                        pnt.Transform(transform)
                        vertex_coords = [pnt.X(), pnt.Y(), pnt.Z()]
                        face_vertices.append(vertex_coords)
                        vertices.append(vertex_coords)
                        face_vertex_normals.extend([0.0, 0.0, 1.0])
                except:
                    print(f"Warning: Could not extract vertices from face {face_index}")
                    face_explorer.Next()
                    face_index += 1
                    continue
            
            # Extract triangles for this face
            face_triangles = []
            face_triangle_indices = []
            
            try:
                # Method 1: Direct triangle access
                for i in range(triangulation.NbTriangles()):
                    tri = triangulation.Triangle(i + 1)  # 1-based indexing
                    n1, n2, n3 = tri.Get()
                    
                    # Adjust indices to global vertex array (0-based)
                    global_indices = [
                        vertex_count + n1 - 1,  # Convert to 0-based
                        vertex_count + n2 - 1,
                        vertex_count + n3 - 1
                    ]
                    triangles.append(global_indices)
                    face_triangles.append(global_indices)
                    face_triangle_indices.append(len(triangles) - 1)  # Store triangle index
                    
            except:
                try:
                    # Method 2: Using array access
                    tris = triangulation.InternalTriangles()
                    for i in range(1, triangulation.NbTriangles() + 1):
                        tri = tris.Value(i)
                        n1, n2, n3 = tri.Get()
                        
                        global_indices = [
                            vertex_count + n1 - 1,
                            vertex_count + n2 - 1,
                            vertex_count + n3 - 1
                        ]
                        triangles.append(global_indices)
                        face_triangles.append(global_indices)
                        face_triangle_indices.append(len(triangles) - 1)
                        
                except:
                    print(f"Warning: Could not extract triangles from face {face_index}")
                    face_explorer.Next()
                    face_index += 1
                    continue
            
            # Calculate face properties
            face_area = calculate_face_area(face_vertices, face_triangles)
            face_center = calculate_face_center(face_vertices)
            face_normal = calculate_face_normal(face_vertices, face_triangles)
            face_bounds = calculate_face_bounds(face_vertices)
            
            # Store face information for mapping
            face_info = {
                'id': f'face_{face_index}',
                'triangleIndices': face_triangle_indices,
                'vertexIndices': list(range(face_start_vertex, face_start_vertex + len(face_vertices))),
                'area': face_area,
                'center': face_center,
                'normal': face_normal,
                'bounds': face_bounds,
                'vertexCount': len(face_vertices),
                'triangleCount': len(face_triangles)
            }
            
            faces_data.append(face_info)
            vertex_count += len(face_vertices)
            
            print(f"Processed face {face_index}: {len(face_vertices)} vertices, {len(face_triangles)} triangles, area: {face_area:.3f}")
        
        face_explorer.Next()
        face_index += 1
    
    return vertices, triangles, faces_data

def calculate_face_area(vertices, triangles):
    """Calculate the total area of a face"""
    total_area = 0.0
    for triangle in triangles:
        # Get triangle vertices (triangle contains global indices, need to map to face vertices)
        # This is simplified - in practice you'd need proper index mapping
        if len(vertices) >= 3:
            # Simple area calculation for the face
            total_area += 1.0  # Placeholder - implement proper area calculation
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

def calculate_face_normal(vertices, triangles):
    """Calculate the normal vector of a face"""
    if len(vertices) < 3:
        return [0.0, 0.0, 1.0]
    
    # Use first triangle to calculate normal
    v1 = vertices[0]
    v2 = vertices[1] if len(vertices) > 1 else vertices[0]
    v3 = vertices[2] if len(vertices) > 2 else vertices[0]
    
    # Calculate cross product
    edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]]
    edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]]
    
    normal = [
        edge1[1] * edge2[2] - edge1[2] * edge2[1],
        edge1[2] * edge2[0] - edge1[0] * edge2[2],
        edge1[0] * edge2[1] - edge1[1] * edge2[0]
    ]
    
    # Normalize
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
    """Process STEP/IGES file and extract mesh data with face mapping"""
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
        
        # Extract mesh data with face information
        vertices, triangles, faces_data = extract_mesh_data(shape)
        
        print(f"Tessellation complete: {len(vertices)} vertices, {len(triangles)} triangles, {len(faces_data)} faces")
        
        # Calculate normals
        vertex_normals = calculate_normals(vertices, triangles)
        
        # Create mesh data structure with face mapping
        mesh_data = {
            "vertices": [coord for vertex in vertices for coord in vertex],  # Flatten to [x,y,z,x,y,z,...]
            "indices": [idx for triangle in triangles for idx in triangle],  # Flatten triangle indices
            "normals": [coord for normal in vertex_normals for coord in normal],  # Flatten normals
            "faces": faces_data,  # Include face mapping information
            "faceIndex": 1,
            "vertexCount": len(vertices),
            "triangleCount": len(triangles),
            "faceCount": len(faces_data)
        }
        
        return [mesh_data]  # Return as array to match JS format
        
    except Exception as e:
        print(f"❌ Error processing file: {e}")
        import traceback
        traceback.print_exc()
        raise e

# Static file serving routes
@app.route('/')
def index():
    """Serve the main HTML file"""
    # Try different possible HTML filenames
    html_files = ['index.html', 'index1.html', 'main.html', 'viewer.html']
    
    for html_file in html_files:
        if os.path.exists(html_file):
            print(f"📄 Serving {html_file}")
            return send_file(html_file)
    
    # If no HTML file found, show server status
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
        <style>
            body {{ font-family: Arial, sans-serif; margin: 40px; }}
            .status {{ background: #e8f5e8; padding: 20px; border-radius: 8px; }}
            .error {{ background: #ffe8e8; padding: 20px; border-radius: 8px; }}
        </style>
    </head>
    <body>
        <div class="status">
            <h1>🐍 Python STEP File Processor</h1>
            <p><strong>✅ Server is running with PythonOCC {occ_version}</strong></p>
            <p>📊 Ready to process STEP files!</p>
        </div>
        <div class="error">
            <p><strong>⚠️ Frontend HTML file not found!</strong></p>
            <p>Please save your HTML file as one of: {', '.join(html_files)}</p>
        </div>
        <h3>Available Endpoints:</h3>
        <ul>
            <li><code>POST /process-step</code> - Upload and process STEP files</li>
            <li><code>GET /test</code> - Test server status</li>
            <li><code>GET /health</code> - Health check</li>
        </ul>
    </body>
    </html>
    '''

@app.route('/<path:filename>')
def static_files(filename):
    """Serve static files (JS, CSS, images, etc.)"""
    try:
        # Security check - prevent directory traversal
        if '..' in filename or filename.startswith('/'):
            return "Invalid file path", 400
        
        # Check if file exists
        if not os.path.exists(filename):
            return f"File {filename} not found", 404
        
        # Enhanced MIME type detection for our specific files
        if filename.endswith('.js'):
            mime_type = 'application/javascript'
        elif filename.endswith('.css'):
            mime_type = 'text/css'
        elif filename.endswith('.html'):
            mime_type = 'text/html'
        elif filename.endswith('.json'):
            mime_type = 'application/json'
        else:
            # Fallback to automatic detection
            mime_type, _ = mimetypes.guess_type(filename)
        
        print(f"📁 Serving static file: {filename} (MIME: {mime_type})")
        
        # Add cache control headers for static files
        response = send_file(filename, mimetype=mime_type)
        
        # Set proper headers for CSS files
        if filename.endswith('.css'):
            response.headers['Content-Type'] = 'text/css; charset=utf-8'
        elif filename.endswith('.js'):
            response.headers['Content-Type'] = 'application/javascript; charset=utf-8'
            
        return response
        
    except Exception as e:
        print(f"❌ Error serving {filename}: {e}")
        return f"Error serving file: {str(e)}", 500

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
        'server_type': 'Python Flask + PythonOCC',
        'static_files_enabled': True
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

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'server': 'Python Flask + PythonOCC',
        'files_in_directory': os.listdir('.')
    })

if __name__ == '__main__':
    print("🚀 Starting Python STEP processing server...")
    try:
        from OCC.Core import VERSION
        print(f"📦 Using PythonOCC version: {VERSION}")
    except:
        print("📦 PythonOCC version: Unknown")
    
    print(f"📁 Current directory: {os.getcwd()}")
    
    # List all files that will be served
    current_files = [f for f in os.listdir('.') if os.path.isfile(f)]
    print(f"📄 Available files:")
    for file in sorted(current_files):
        if file.endswith(('.html', '.js', '.css', '.json')):
            print(f"   ✅ {file}")
    
    print("🌐 Server will run on http://localhost:3000")
    print("📊 Ready to process STEP files server-side!")
    print("🔧 Static file serving enabled for HTML, JS, CSS, etc.")
    print("🎯 Face selection and STL export features available!")
    
    app.run(host='0.0.0.0', port=3000, debug=True)