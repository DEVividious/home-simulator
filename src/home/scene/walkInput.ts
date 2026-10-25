// Analog walk input (virtual joystick on touch): f — forward (+) / back (−), s — right (+) / left (−), range −1…1.
// Read every frame by both walk controllers (building and site: WalkLayer; room: CameraController) alongside the keys.
export const walkInput = { f: 0, s: 0 };
export const resetWalkInput = () => { walkInput.f = 0; walkInput.s = 0; };
