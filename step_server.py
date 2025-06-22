#!/usr/bin/env python3
"""
Python STEP file processor using CadQuery
Equivalent to your Node.js OpenCascade.js server
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import cadquery as cq
from cadquery import importers
import os
import tempfile
import time
import json
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configuration
UPLOAD_FOLDER = 'temp'
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {'.step', '.stp', '.iges', '.igs'}

# Ensure upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    """Check if file extension is allowed"""
    return any(filename.lower().endswith(ext) for ext in ALLOWED_EXTENSIONS)

def process_step_file(file_path):
    """Process STEP file and extract mesh data"""
    print(f"Processing STEP file: {file_path}")
    
    try:
        # Import STEP file using CadQuery
        shape = importers.importStep(file_path)
        print("STEP file imported successfully")
        
        # Get the actual shape object
        cad_object = shape.val()
        
        # Tessellate the shape to get mesh data
        # Lower tolerance = higher quality but more triangles
        tolerance = 10
        vertices, triangles = cad_object.tessellate(0.5, 0.25)
        
        print(f" Tessellation complete: {len(vertices)} vertices, {len(triangles)} triangles")
        print(f"Vertex type: {type(vertices[0]) if vertices else 'No vertices'}")
        print(f"Triangle type: {type(triangles[0]) if triangles else 'No triangles'}")
        
        # Convert CadQuery Vector objects to plain lists
        vertex_list = []
        for v in vertices:
            if hasattr(v, 'x') and hasattr(v, 'y') and hasattr(v, 'z'):
                # CadQuery Vector object
                vertex_list.append([v.x, v.y, v.z])
            elif hasattr(v, 'toTuple'):
                # CadQuery Vector with toTuple method
                vertex_list.append(list(v.toTuple()))
            elif len(v) == 3:
                # Already a tuple/list
                vertex_list.append([float(v[0]), float(v[1]), float(v[2])])
            else:
                print(f"Unknown vertex format: {v}, type: {type(v)}")
                vertex_list.append([0.0, 0.0, 0.0])
        
        # Convert triangle indices
        triangle_list = []
        for t in triangles:
            if hasattr(t, '__iter__') and len(t) == 3:
                triangle_list.append([int(t[0]), int(t[1]), int(t[2])])
            else:
                print(f"Unknown triangle format: {t}, type: {type(t)}")
                triangle_list.append([0, 0, 0])
        
        print(f" Converted {len(vertex_list)} vertices and {len(triangle_list)} triangles")
        
        # Calculate simple normals for each vertex
        vertex_normals = []
        for i in range(len(vertex_list)):
            # Default normal pointing up (will be improved later)
            vertex_normals.extend([0.0, 0.0, 1.0])
        
        # Create mesh data structure matching your Node.js format
        mesh_data = {
            "vertices": [coord for vertex in vertex_list for coord in vertex],  # Flatten to [x,y,z,x,y,z,...]
            "indices": [idx for triangle in triangle_list for idx in triangle],  # Flatten triangle indices
            "normals": vertex_normals,  # Normal for each vertex [x,y,z,x,y,z,...]
            "faceIndex": 1,
            "vertexCount": len(vertex_list),
            "triangleCount": len(triangle_list)
        }
        
        return [mesh_data]  # Return as array to match JS format
        
    except Exception as e:
        print(f"❌ Error processing STEP file: {e}")
        import traceback
        traceback.print_exc()
        raise e

@app.route('/test', methods=['GET'])
def test_endpoint():
    """Test endpoint to verify server is working"""
    return jsonify({
        'message': 'Python CadQuery STEP server is working',
        'cadquery_version': cq.__version__,
        'python_version': f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
        'server_type': 'Python Flask + CadQuery'
    })

@app.route('/process-step', methods=['POST'])
def process_step():
    """Main endpoint for processing STEP files"""
    print('\n=== STEP Processing Request (Python/CadQuery) ===')
    
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
        print("Processing STEP file with CadQuery...")
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
    """Serve a simple index page"""
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Python STEP Processor</title>
    </head>
    <body>
        <h1>🐍 Python STEP File Processor</h1>
        <p>Server is running with CadQuery {}</p>
        <p>Upload STEP files to <code>/process-step</code> endpoint</p>
        <p>Test server at <code>/test</code> endpoint</p>
    </body>
    </html>
    '''.format(cq.__version__)

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'server': 'Python Flask + CadQuery'
    })

if __name__ == '__main__':
    print("🚀 Starting Python STEP processing server...")
    print(f"📦 Using CadQuery version: {cq.__version__}")
    print("🌐 Server will run on http://localhost:3000")
    print("📊 Ready to process STEP files server-side!")
    
    app.run(host='0.0.0.0', port=3000, debug=True)