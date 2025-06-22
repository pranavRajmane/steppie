#create conda env
conda create env -n steppie

#install pythonocc-core
conda install -c conda-forge pythonocc-core

#install flask cors
pip install flask flask-cors cadquery

#check pythonocc installation
python3 -c "from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox; print('Success!')"

#start server and go to the address in the terminal(port:3000)
python3 occserver.py