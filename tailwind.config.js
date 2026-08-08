/** @type {import('tailwindcss').Config} */
export default {
  // 已去掉 Tailwind Play CDN（微信安全扫描会把远程脚本判为可注入），
  // 全部走本地构建 → content 必须覆盖所有出现类名的文件。
  content: [
    "./index.html",
    "./*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./services/**/*.{js,ts,jsx,tsx}",
    "./electron/**/*.{js,cjs,html}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
