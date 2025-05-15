const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

const SIZES = [16, 32, 48, 128];
const ICON_COLOR = '#ffd700'; // Gold color for the icon

async function generateIcons() {
  // Ensure icons directory exists
  const iconsDir = path.join(__dirname, '..', 'icons');
  await fs.mkdir(iconsDir, { recursive: true });

  // Create an SVG template for the icon
  const svgIcon = `
    <svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" fill="#1c1c1c"/>
      <path d="M64 16L80 48L112 56L88 80L96 112L64 96L32 112L40 80L16 56L48 48L64 16Z" 
            fill="${ICON_COLOR}" 
            stroke="#ffffff" 
            stroke-width="4"/>
    </svg>
  `;

  // Generate icons for each size
  for (const size of SIZES) {
    await sharp(Buffer.from(svgIcon))
      .resize(size, size)
      .toFile(path.join(iconsDir, `icon${size}.png`));
    
    console.log(`Generated ${size}x${size} icon`);
  }

  console.log('Icon generation complete!');
}

generateIcons().catch(console.error); 