import cadquery as cq

def create_merged_hollow_box(stp_file_path, output_file_path, wall_thickness=2.0):
    """
    Simple function: Load STP file, create hollow bounding box, merge with original, save.
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
    
    print(f"Box size: {length:.1f} x {width:.1f} x {height:.1f}")
    
    # Create hollow box
    outer_box = (cq.Workplane("XY")
                .box(length, width, height)
                .translate((center_x, center_y, center_z)))
    
    inner_box = (cq.Workplane("XY")
                .box(length - 2*wall_thickness, width - 2*wall_thickness, height - 2*wall_thickness)
                .translate((center_x, center_y, center_z)))
    
    hollow_box = outer_box.cut(inner_box)
    
    # Merge with original part
    merged = hollow_box.union(imported_shape)
    print("Merged part with hollow box")
    
    # Save
    cq.exporters.export(merged, output_file_path, exportType='STEP')
    print(f"Saved: {output_file_path}")
    
    return merged

# Usage
if __name__ == "__main__":
    input_file = "pulley_gating_model.stp"
    output_file = "part_with_hollow_box.stp"
    
    result = create_merged_hollow_box(input_file, output_file, wall_thickness=2.0)
    print("Done!")