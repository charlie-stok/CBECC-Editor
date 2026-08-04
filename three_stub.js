class Vec3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;} getSize(t){t.set(1,1,1);return t;} getCenter(t){t.set(0,0,0);return t;} }
class Box3 { constructor(){this.min=new Vec3();this.max=new Vec3();this._empty=true;} union(b){this._empty=false;return this;} isEmpty(){return this._empty;} getSize(t){return t.set(1,1,1);} getCenter(t){return t.set(0,0,0);} setFromObject(){return this;} }
global.THREE = {
  Scene: function(){ this.children=[]; this.add=(o)=>this.children.push(o); this.remove=(o)=>{const i=this.children.indexOf(o); if(i>=0) this.children.splice(i,1);}; },
  PerspectiveCamera: function(){ this.position=new Vec3(); this.updateProjectionMatrix=()=>{}; },
  WebGLRenderer: function(){ this.domElement=global.__testDocument.createElement('canvas'); this.setSize=()=>{}; this.render=()=>{}; },
  AmbientLight: function(){}, DirectionalLight: function(){ this.position=new Vec3(); },
  Color: function(hex){ this.getHexString=()=>"ffffff"; this.setHex=()=>{}; this.copy=()=>{}; },
  MeshStandardMaterial: function(opts){ Object.assign(this, opts||{}); this.color = new global.THREE.Color(); },
  BufferGeometry: function(){ this.setAttribute=()=>{}; this.computeVertexNormals=()=>{}; this.computeBoundingBox=()=>{ this.boundingBox = new Box3(); }; },
  Float32BufferAttribute: function(){},
  Mesh: function(geom, mat){ this.geometry=geom; this.material=mat; this.userData={}; },
  DoubleSide: "DoubleSide",
  Vector3: Vec3,
  Vector2: function(x,y){ this.x=x;this.y=y; },
  Box3: Box3,
  Raycaster: function(){ this.setFromCamera=()=>{}; this.intersectObjects=()=>[]; },
  OrbitControls: function(){ this.update=()=>{}; this.target=new Vec3(); },
};
