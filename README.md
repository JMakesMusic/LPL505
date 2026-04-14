# LPL505: Launchpadless 505

LPL505 is a small but powerful desktop application built to fully unlock and control the Boss RC-505mk2 loop station via USB MIDI. 

It can be used to replicate the [infinite fx changes technique](https://www.youtube.com/watch?v=-gfB4Krj22I) without the need of a Novation Launchpad Pro MK3.

YT Tutorial on how to set it up and use it. (WIP)

## Features

- **Customisable Workspace:** Build an unlimited array of buttons and faders on a free-form, scalable UI canvas.
- **RC-505mk2-Specific design:** Buttons for the Infinite FX changes technique, general MIDI messages, or [MIDI program changes](https://www.youtube.com/watch?v=67y-oijQv1A)
- **Save & Load Templates:** Share templates with your friends and load them up whenever you want.
- **Responsive & Smart UI:**
  - Toggle between "Edit" and "Perform" mode. Prevents accidental changes while live performing.
  - Fully resizable window with intelligent coordinate scaling.
  - A smooth free positioning / grid system with instant "Snap-All" capability.
  - Rubber-band multi-select and group dragging.
- **Aesthetic Customization:** 
  - Dark mode & Light mode
  - Custom user-imported background images.
  - Native OS Color Pickers for every widget, combined with a 
  - "Glow Intensity" system for live visual trigger feedback.
- **MIDI Clock Quantization:** Delay a trigger impact until the "Next Beat" or "Next Bar", or quantize to stay perfectly in time with the mk2's internal clock.

## Installation

### 1. Download the App
You can download the installers from the **[Releases](https://github.com/JMakesMusic/LPL505/releases)** page. Under the "Assets" section, pick the correct file for your computer:

| Device | Supported Version | File to Download |
| :--- | :--- | :--- |
| **Windows PC** | Latest | `LPL505_x64-setup.exe` (Recommended) |
| **Mac (M series chips)** | Latest | `LPL505_aarch64.dmg` |
| **Mac (Intel / Older)** | v2.0.0 (Legacy) | `LPL505_x64.dmg` |
| **Linux (General)** | v2.0.0 (Legacy) | `LPL505_amd64.AppImage` / `.deb` / `.rpm` |

> [!NOTE]
> **Platform Support Update:** Starting from versions after **v2.0.0**, we have discontinued official support for Linux and Intel-based Macs to focus development on the most used platforms (Windows and Apple Silicon). Users on these discontinued platforms can still use **[Release v2.0.0](https://github.com/JMakesMusic/LPL505/releases/tag/LPL505-v2.0.0)** perfectly fine.

> [!IMPORTANT]
>Since this project is independent and open-source, your operating system may flag the app as unverified. Dont worry, the code is fully transparent and viewable right here on GitHub.
>**Windows Users** If you recieve a "Windows protected your PC" popup, click **"More info"** and then **"Run anyway"**.
>**Mac Users:** If you get a "damaged" or "developer cannot be verified" error, open your Terminal and run the following command to allow the app to run:
> ```markdown
>sudo xattr -cr /Applications/LPL505.app
> ```

### 2. Install MK2 Presets (Required)
This app works specifically with a Boss RC-505mk2 connected via USB. You **must** install the provided `.RC0` memory files to your loop station for the app markers to function correctly.

1. Connect your RC-505mk2 to your computer in **Storage Mode**.
2. Navigate to the `ROLAND/DATA` folder on the RC-505mk2 drive.
3. Copy the 2 memory files from the **[resources/boss-rc505mk2-presets](./resources/boss-rc505mk2-presets)** folder of this repository into your machine.

## Building From Source

LPL505 was built with React, TypeScript, and **[Tauri v2](https://v2.tauri.app/)** with a Rust backend.

### Prerequisites
- Node.js (v20+)
- Rust (`rustup` toolchain)
- macOS: Xcode / Command Line Tools
- Windows: Visual Studio C++ Build Tools

### Development Setup
```bash
git clone https://github.com/JMakesMusic/LPL505.git
cd LPL505

# Install JS dependencies
npm install

# Run application in development mode
npm run tauri dev

# Compile final production executable
npm run tauri build
```

## Credits

Developed by [@jmakesmusicx](https://www.youtube.com/@JMakesMusicx).
If you found this software useful for your looping performances, consider tossing a tip to my **[Ko-fi page](https://ko-fi.com/jmakesmusicx)**!

## Disclaimer

**Launchpadless505** is an independent, open-source community project. It is **not** affiliated with, authorized, maintained, sponsored, or endorsed by **BOSS**, **Roland**, or **Novation**.
All product and company names are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them. 
This tool is provided "as-is" for the purpose of extending hardware functionality and does not contain or distribute any proprietary software or copyrighted code belonging to the aforementioned companies.