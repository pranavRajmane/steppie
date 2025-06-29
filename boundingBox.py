import cadquery as cq

def create_bounding_box_stl(stp_file_path, output_file_path, wall_thickness=2.0):
    """
    Load STP file, create a hollow bounding box around it, and save as STL.
    
    Args:
        stp_file_path (str): Path to input STP file
        output_file_path (str): Path for output STL file
        wall_thickness (float): Thickness of box walls in mm
    
    Returns:
        cadquery.Workplane: The hollow box object
    """
    # Load the STP file
    imported_shape = cq.importers.importStep(stp_file_path)
    print(f"Loaded: {stp_file_path}")
    
    # Get bounding box dimensions
    bbox = imported_shape.val().BoundingBox()
    length = bbox.xlen
    width = bbox.ylen
    height = bbox.zlen
    center_x = (bbox.xmin + bbox.xmax) / 2
    center_y = (bbox.ymin + bbox.ymax) / 2
    center_z = (bbox.zmin + bbox.zmax) / 2
    
    print(f"Model dimensions: {length:.1f} x {width:.1f} x {height:.1f} mm")
    print(f"Box center: ({center_x:.1f}, {center_y:.1f}, {center_z:.1f})")
    
    # Create hollow bounding box
    outer_box = (cq.Workplane("XY")
                 .box(length, width, height)
                 .translate((center_x, center_y, center_z)))
    
    inner_box = (cq.Workplane("XY")
                 .box(length - 2*wall_thickness, 
                      width - 2*wall_thickness, 
                      height - 2*wall_thickness)
                 .translate((center_x, center_y, center_z)))
    
    hollow_box = outer_box.cut(inner_box)
    print(f"Created hollow box with {wall_thickness}mm wall thickness")
    
    # Export as STL
    cq.exporters.export(hollow_box, output_file_path)
    print(f"Saved STL: {output_file_path}")
    
    return hollow_box

# Usage
if __name__ == "__main__":
    input_file = "pulley_gating_model.stp"
    output_file = "bounding_box.stl"
    
    result = create_bounding_box_stl(input_file, output_file, wall_thickness=2.0)
    print("Bounding box STL created successfully!")