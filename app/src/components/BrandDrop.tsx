/* Брендовая капля глюкозы — логотип для заставки/лоадера/подключения. */
export default function BrandDrop({ size = 92, pulse = false }: { size?: number; pulse?: boolean }) {
  return (
    <svg className={'b-drop' + (pulse ? ' pulse' : '')} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="bdrop" x1="256" y1="104" x2="256" y2="412" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e6e2ff" />
          <stop offset="0.45" stopColor="#b7aef0" />
          <stop offset="1" stopColor="#8375d3" />
        </linearGradient>
      </defs>
      <path d="M256 104 C256 104 372 250 372 330 a116 116 0 1 1 -232 0 C140 250 256 104 256 104 Z" fill="url(#bdrop)" />
      <ellipse cx="212" cy="292" rx="30" ry="52" fill="#ffffff" opacity="0.28" transform="rotate(-24 212 292)" />
      <path d="M176 344 h34 l16 -40 l22 78 l20 -58 l14 20 h30" fill="none" stroke="#161826" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}
