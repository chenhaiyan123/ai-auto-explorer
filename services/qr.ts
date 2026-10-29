// 只用 qrcode 的核心和 SVG 渲染（不带 PNG / 文件系统部分），打包进 server/.wake-build/qr.mjs：镜像里没有 node_modules
// @ts-ignore 没有类型声明
import QRCode from 'qrcode/lib/core/qrcode';
// @ts-ignore 没有类型声明
import SvgTag from 'qrcode/lib/renderer/svg-tag';
/** 后台用：把微信支付链接画成 SVG 二维码 */
export const qrSvg = async (text: string): Promise<string> => SvgTag.render(QRCode.create(text, { errorCorrectionLevel: 'M' }), { margin: 1, width: 220 });
