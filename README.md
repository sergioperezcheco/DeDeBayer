# DeDeBayer

**Bayer 滤色阵列与解拜耳（Demosaic）算法交互式可视化工具**

纯前端实现，所有计算在浏览器本地完成，图片不会上传到任何服务器。

![DeDeBayer Screenshot](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## 目录

- [什么是 Bayer 滤色阵列](#什么是-bayer-滤色阵列)
- [项目功能](#项目功能)
- [解拜耳算法](#解拜耳算法)
- [技术栈](#技术栈)
- [本地开发](#本地开发)
- [部署](#部署)
- [参考文献](#参考文献)
- [License](#license)

---

## 什么是 Bayer 滤色阵列

### 数码相机成像原理

数码相机的图像传感器（CCD/CMOS）本质上是一个光电转换器阵列。每个像素（photosite）只能测量落在其上的光的**总强度**，无法区分颜色。为了获得彩色图像，1976 年柯达工程师 Bryce Bayer 发明了一种巧妙的方案：在传感器前方放置一层微型彩色滤光片阵列（Color Filter Array, CFA）。

### Bayer 模式

最常见的 CFA 排列是 **RGGB**（也称 Bayer 模式）：

```
┌───┬───┬───┬───┬───┬───┐
│ R │ G │ R │ G │ R │ G │
├───┼───┼───┼───┼───┼───┤
│ G │ B │ G │ B │ G │ B │
├───┼───┼───┼───┼───┼───┤
│ R │ G │ R │ G │ R │ G │
├───┼───┼───┼───┼───┼───┤
│ G │ B │ G │ B │ G │ B │
└───┴───┴───┴───┴───┴───┘
```

关键特征：
- **绿色像素占 50%**：人眼对绿色（亮度信息）最敏感，因此绿色采样密度是红蓝的两倍
- **红色和蓝色各占 25%**
- 每个像素只记录了**一个颜色通道**的信息，另外两个通道完全缺失

### 为什么需要解拜耳（Demosaicing）

由于每个像素只有一个颜色通道的数据，要得到完整的 RGB 彩色图像，必须通过算法**估算**（插值）每个像素缺失的两个通道。这个过程称为**解拜耳**（Demosaicing / Debayering）。

解拜耳算法的质量直接影响最终图像的：
- **锐度**：差的算法会模糊边缘
- **伪色（Color Artifacts）**：在高频纹理区域产生不存在的彩色条纹
- **摩尔纹（Moiré）**：规则纹理与 Bayer 模式产生干涉
- **拉链效应（Zipper Effect）**：边缘处出现锯齿状彩色伪影

### 其他 Bayer 变体

除了 RGGB，还有三种旋转变体：
- **BGGR**：蓝色在左上角
- **GRBG**：绿色在左上角，红色在右上角
- **GBRG**：绿色在左上角，蓝色在右上角

不同相机厂商使用不同的排列，但算法原理相同。

### 光学低通滤波器（OLPF）

为了减少摩尔纹和伪色，大部分数码相机在传感器前还放置了一片**光学低通滤波器**（Anti-Aliasing Filter）。它轻微模糊入射光，使得高频细节不会超过 Bayer 阵列的奈奎斯特频率。代价是牺牲了一些锐度。

近年来一些相机（如 Nikon D800E、Pentax K-5 IIs）取消了 OLPF，依赖更先进的解拜耳算法来处理伪色问题。

---

## 项目功能

1. **上传图片**：支持 RAW 格式（NEF/CR2/ARW/DNG 等）和普通图片（JPEG/PNG）
2. **Bayer 马赛克可视化**：
   - 灰度模式：模拟传感器原始输出
   - 彩色模式：用红/绿/蓝着色显示每个像素的滤色片归属
3. **解拜耳算法演示**：
   - 从图片中选择任意 200×200 区域
   - 像素级放大显示
   - 逐步动画展示插值过程
   - 5 种经典算法对比
4. **图片查看器**：滚轮缩放、拖拽平移、旋转
5. **保存功能**：任意视图可导出为 PNG
6. **RAW 文件支持**：自动解析 TIFF 结构，提取内嵌全尺寸 JPEG 预览，正确处理 EXIF Orientation

---

## 解拜耳算法

本项目实现了 5 种经典解拜耳算法，按复杂度递增排列：

### 1. 最近邻（Nearest Neighbor）

最简单的方法。对于每个缺失的颜色通道，直接复制距离最近的同色像素值。

- **优点**：计算极快，实现简单
- **缺点**：产生严重的块状伪影和锯齿
- **复杂度**：O(1) per pixel

### 2. 双线性插值（Bilinear Interpolation）

对缺失通道取周围同色像素的算术平均值。

- **优点**：简单有效，比最近邻平滑很多
- **缺点**：在边缘处模糊，会产生拉链效应
- **复杂度**：O(1) per pixel（3×3 邻域）

### 3. 平滑色调（Smooth Hue / Constant Hue-Based）

基于 Kimmel (1999) 的思路。核心观察：自然图像中**色调**（hue）的空间变化比**亮度**（luminance）更平滑。

算法步骤：
1. 先用双线性插值得到完整的 G（亮度）通道
2. 计算色调比率 R/G 和 B/G
3. 对色调比率进行插值（而非直接对 R、B 插值）
4. 用插值后的比率乘以 G 得到 R 和 B

- **优点**：显著减少伪色，边缘保持更好
- **缺点**：在 G 接近 0 的暗区可能不稳定
- **复杂度**：O(1) per pixel，两遍扫描

### 4. Malvar-He-Cutler（2004）

微软研究院提出的高质量线性插值方法。使用 4 种 5×5 卷积核，关键创新是**利用其他颜色通道的高频信息**来修正插值结果。

核心思想：在估计某个位置的 G 值时，不仅看周围的 G 像素，还利用当前位置已知的 R 或 B 值（它们包含了局部高频信息）来修正估计。

4 种卷积核（所有系数除以 8）：
- **Pattern 1**：在 R/B 位置估计 G
- **Pattern 2**：在 G 位置估计水平方向的 R 或 B
- **Pattern 3**：在 G 位置估计垂直方向的 R 或 B
- **Pattern 4**：在 R 位置估计 B（或反之，对角方向）

- **优点**：线性算法中质量最高，计算效率好
- **缺点**：仍是线性方法，无法完全消除边缘伪色
- **复杂度**：O(1) per pixel（5×5 固定核）

### 5. 边缘导向插值（Edge-Directed / Hamilton & Adams）

基于 Hamilton & Adams (1997) 的思路。核心创新：在插值前先**检测局部边缘方向**，然后只沿边缘方向插值，避免跨越边缘。

算法步骤：
1. 计算水平梯度 dH 和垂直梯度 dV
2. 如果 dH < dV：沿水平方向插值（垂直方向有边缘）
3. 如果 dV < dH：沿垂直方向插值（水平方向有边缘）
4. 如果 dH ≈ dV：取两个方向的平均
5. 利用色差（R-G, B-G）的平滑性恢复 R 和 B

- **优点**：边缘保持优秀，伪色少
- **缺点**：在对角边缘处仍可能产生伪影
- **复杂度**：O(1) per pixel，但常数较大

---

## 技术栈

| 技术 | 用途 |
|------|------|
| [Vite](https://vite.dev/) 6 | 构建工具 |
| [React](https://react.dev/) 19 | UI 框架 |
| [TypeScript](https://www.typescriptlang.org/) 5.8 | 类型安全 |
| [Tailwind CSS](https://tailwindcss.com/) 4 | 样式 |
| Canvas API | 图像渲染与像素操作 |
| Web Worker | 后台计算（可选） |

纯前端，零后端依赖，适合部署到任何静态托管平台。

---

## 本地开发

```bash
# 克隆
git clone https://github.com/sergioperezcheco/DeDeBayer.git
cd DeDeBayer

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

---

## 部署

### Cloudflare Pages（推荐）

**方式一：GitHub 集成（自动）**

1. Fork 本仓库
2. 在 Cloudflare Dashboard 创建 Pages 项目，连接 GitHub 仓库
3. 构建设置：
   - 构建命令：`npm run build`
   - 输出目录：`dist`
4. 每次 push 到 main 自动部署

**方式二：GitHub Actions（本仓库已配置）**

在仓库 Settings → Secrets 中添加：
- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token（需要 Pages 编辑权限）
- `CLOUDFLARE_ACCOUNT_ID`：你的 Cloudflare Account ID

Push 到 main 即自动部署。

### Docker

```bash
# 构建镜像
docker build -t dedebayer .

# 运行
docker run -p 8080:80 dedebayer
```

访问 http://localhost:8080

也可以直接拉取 GitHub Container Registry 的镜像：

```bash
docker pull ghcr.io/sergioperezcheco/dedebayer:latest
docker run -p 8080:80 ghcr.io/sergioperezcheco/dedebayer:latest
```

### 其他平台

本项目是纯静态站点，`npm run build` 后将 `dist/` 目录部署到任何静态托管即可：
- Vercel：零配置，连接 GitHub 即可
- Netlify：构建命令 `npm run build`，发布目录 `dist`
- GitHub Pages：使用 `gh-pages` 分支或 Actions

---

## 参考文献

1. **Bayer, B. E.** (1976). *Color imaging array*. U.S. Patent 3,971,065.

2. **Hamilton, J. F., & Adams, J. E.** (1997). *Adaptive color plan interpolation in single sensor color electronic camera*. U.S. Patent 5,629,734. — 边缘导向插值的奠基性专利。

3. **Kimmel, R.** (1999). *Demosaicing: Image reconstruction from color CCD samples*. IEEE Transactions on Image Processing, 8(9), 1221-1228. — 提出利用色调平滑性的解拜耳方法。

4. **Malvar, H. S., He, L., & Cutler, R.** (2004). *High-quality linear interpolation for demosaicing of Bayer-patterned color images*. IEEE International Conference on Acoustics, Speech, and Signal Processing (ICASSP), vol. 3, pp. 485-488. — 微软研究院提出的 5×5 卷积核方法。[PDF](https://www.microsoft.com/en-us/research/publication/high-quality-linear-interpolation-for-demosaicing-of-bayer-patterned-color-images/)

5. **Gunturk, B. K., Glotzbach, J., Altunbasak, Y., Schafer, R. W., & Mersereau, R. M.** (2005). *Demosaicking: Color filter array interpolation*. IEEE Signal Processing Magazine, 22(1), 44-54. — 解拜耳算法的综述论文。

6. **Menon, D., Andriani, S., & Calvagno, G.** (2007). *Demosaicing with directional filtering and a posteriori decision*. IEEE Transactions on Image Processing, 16(1), 132-141. — 更先进的方向性滤波方法。

7. **Li, X., Gunturk, B., & Zhang, L.** (2008). *Image demosaicing: A systematic survey*. Proceedings of SPIE, vol. 6822. — 全面的解拜耳算法调研。

---

## License

MIT
