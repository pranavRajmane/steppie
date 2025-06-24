#create conda env
```sh
conda create -n steppie
```
#activate conda env
```sh
conda activate steppie
```

#install pythonocc-core
```sh
conda install -c conda-forge pythonocc-core
```
#install flask cors
```sh
pip install flask flask-cors cadquery
```
#check pythonocc installation
```sh
python3 -c "from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox; print('Success!')"
```
#start server and go to the address in the terminal(port:3000)
```sh
python3 occserver.py
```