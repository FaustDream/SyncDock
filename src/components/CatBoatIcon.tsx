export function CatBoatIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="currentColor" {...props}>
      {/* 波浪背景 */}
      <defs>
        <linearGradient id="waveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      
      {/* 波浪 */}
      <path d="M 0,85 Q 30,75 60,85 T 120,85 L 120,120 L 0,120 Z" fill="url(#waveGradient)" />
      <path d="M 0,95 Q 30,85 60,95 T 120,95 L 120,120 L 0,120 Z" fill="var(--primary)" opacity="0.15" />
      
      {/* 船身 */}
      <path 
        d="M 25,70 Q 25,55 60,55 Q 95,55 95,70 L 90,85 Q 60,95 30,85 Z" 
        fill="var(--primary)" 
        opacity="0.9"
      />
      <path 
        d="M 30,58 L 60,52 L 90,58" 
        stroke="var(--bg)" 
        strokeWidth="2" 
        fill="none"
        opacity="0.6"
      />
      
      {/* 猫咪身体 */}
      <ellipse cx="60" cy="45" rx="18" ry="14" fill="currentColor" />
      
      {/* 猫咪头部 */}
      <circle cx="60" cy="32" r="12" fill="currentColor" />
      
      {/* 猫耳朵 */}
      <path d="M 50,22 L 46,10 L 54,18 Z" fill="currentColor" />
      <path d="M 70,22 L 74,10 L 66,18 Z" fill="currentColor" />
      <path d="M 51,21 L 48,12 L 54,18 Z" fill="var(--accent, #ff9f43)" />
      <path d="M 69,21 L 72,12 L 66,18 Z" fill="var(--accent, #ff9f43)" />
      
      {/* 猫眼睛 */}
      <ellipse cx="55" cy="30" rx="2.5" ry="3" fill="var(--bg)" />
      <ellipse cx="65" cy="30" rx="2.5" ry="3" fill="var(--bg)" />
      <circle cx="55" cy="30" r="1.5" fill="var(--text)" />
      <circle cx="65" cy="30" r="1.5" fill="var(--text)" />
      
      {/* 猫鼻子和嘴 */}
      <path d="M 58,35 L 60,37 L 62,35" stroke="var(--accent, #ff9f43)" strokeWidth="1.5" fill="none" />
      <path d="M 60,37 Q 60,40 57,39" stroke="var(--text-secondary)" strokeWidth="1" fill="none" opacity="0.6" />
      <path d="M 60,37 Q 60,40 63,39" stroke="var(--text-secondary)" strokeWidth="1" fill="none" opacity="0.6" />
      
      {/* 猫胡须 */}
      <g stroke="var(--text-secondary)" strokeWidth="0.8" opacity="0.5">
        <line x1="48" y1="33" x2="40" y2="31" />
        <line x1="48" y1="35" x2="40" y2="36" />
        <line x1="72" y1="33" x2="80" y2="31" />
        <line x1="72" y1="35" x2="80" y2="36" />
      </g>
      
      {/* 船帆 */}
      <path 
        d="M 60,48 L 60,15 L 85,38 Z" 
        fill="var(--bg)" 
        stroke="var(--primary)"
        strokeWidth="1.5"
      />
      <path 
        d="M 60,48 L 60,20 L 40,40 Z" 
        fill="var(--bg)" 
        stroke="var(--primary)"
        strokeWidth="1.5"
        opacity="0.7"
      />
      
      {/* 桅杆 */}
      <line x1="60" y1="15" x2="60" y2="55" stroke="var(--text-secondary)" strokeWidth="2" />
      
      {/* 小旗 */}
      <path d="M 60,15 L 72,12 L 60,8 Z" fill="var(--accent, #ff9f43)" />
    </svg>
  );
}
