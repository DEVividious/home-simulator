# House Forge

A Claude Code plugin: floor plans of a house or flat → a 3D-printable scale model (STL parts that fit your printer's bed), with
the roof, a preview of what was read and your approval before the build.

```bash
claude plugin marketplace add DEVividious/house-forge
claude plugin install house-forge@house-forge
```

Then, in a directory with your plans: "Make a printable model of my house from these plans — I have a Creality K1C."

The plugin is in [`plugins/house-forge/`](plugins/house-forge/README.md). It is built from the
[Home Simulator](https://github.com/DEVividious/home-simulator) repository (`npm run plugin:build`), which holds its source and
tests; `skills/house-forge/scripts/VERSION.json` names the engine commit of this build. Changes: [CHANGELOG.md](CHANGELOG.md).
