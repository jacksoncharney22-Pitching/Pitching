// Test-only stand-in for OrbitControls (camera looks at the target, no dragging) plus shims for older three.js builds.
THREE.OrbitControls = function (cam, el) { this.target = new THREE.Vector3(); this.update = () => cam.lookAt(this.target); this.addEventListener = () => {}; };
// test-only shims: r97 -> r128 API names
if (!THREE.BufferGeometry.prototype.setAttribute) THREE.BufferGeometry.prototype.setAttribute = THREE.BufferGeometry.prototype.addAttribute;
if (THREE.ACESFilmicToneMapping === undefined) THREE.ACESFilmicToneMapping = THREE.LinearToneMapping;
