# OpenLap Studio

[English](README.md) | [简体中文](README.zh-CN.md)

OpenLap 是一个免费的开源赛车视频与遥测工具。本仓库是由
**playchess2005** 维护的 OpenLap 分支，重点用于将赛车视频与 Vector BLF/CAN
数据结合，并把解码后的信号制作成视频叠加层。

本项目基于原作者 [LaurensVR3 的 OpenLap](https://github.com/LaurensVR3/OpenLap/tree/main)
开发。下面介绍的 Studio、BLF/DBC、Signal 和关键帧对齐功能属于本仓库的后续
开发，不应被误认为是原项目功能。

当前版本为 **v0.4.0**，核心工作流是 Studio：

```text
MP4/视频 + Vector BLF
        ↓
扫描 BLF 通道 → 绑定 DBC → 选择 Signal
        ↓
通过关键帧手动对齐视频与 BLF
        ↓
添加 Overlay 卡片并导出视频
```

OpenLap 在本地运行，视频、BLF 和 DBC 文件不会上传到服务器。项目采用 GNU
GPL v3（或更高版本）许可证。

## 本版本的重点功能

- **BLF 与视频对齐**：在 Studio 中同时加载视频和 Vector `.blf`，在同一时间轴
  上查看运行数据，精确设置视频时间与 BLF 时间的对应关系。
- **DBC 解码**：可以为每个 BLF 通道绑定一个或多个 `.dbc` 文件。绑定关系会保存
  到工程中，并用于把 CAN 帧解码为有名称、有单位的物理信号。
- **Signal 工作流**：扫描解码结果后，可以按通道、CAN ID、Message、Signal、单位
  或 DBC 文件搜索并选择 `Message.Signal`。时间轴只读取选中的轨迹。
- **关键帧对齐**：在明显事件处添加关键帧，选中后将其一键对齐到当前视频位置；支持
  添加、选择、删除关键帧，以及时间轴缩放和平移。
- **独立轨迹修正**：除了全局 BLF 偏移，还可以为方向盘、横摆角速度等轨迹设置独立
  偏移，修正不同信号之间的小幅时间差。
- **可复用 Overlay**：从 Studio 进入 Overlay 编辑器，添加方向盘、踏板、四轮扭矩、
  横摆角速度，以及数字、刻度盘、柱状图、曲线、地图和 Session 信息等卡片。

## Studio 使用流程

### 1. 选择素材

打开 **Studio**，选择赛车视频和 Vector BLF 文件，然后点击 **载入素材**。BLF
通道扫描会显示进度、帧数和预计剩余时间；扫描结果会缓存，重复打开同一文件时无需
重新完整扫描。

### 2. 为 BLF 通道绑定 DBC

打开 **DBC 配置** 并扫描 BLF。每个发现的通道都可以添加一个或多个 DBC。多个 DBC
存在时，列表顺序决定解码尝试顺序；发生 CAN ID 冲突时，OpenLap 会报告冲突，而不是
静默覆盖结果。

DBC 不是日志本身，而是描述如何把消息字节转换为信号的数据库，包括起始位、长度、
字节序、比例、偏移、单位和枚举值等信息。

### 3. 选择 Signal

进入 **Signal** 选择页面，扫描已经绑定 DBC 的 BLF，并建立可用信号目录。可以按
BLF 通道、CAN ID、消息名、信号名、单位、DBC 文件名或来源过滤。勾选需要的信号后，
可以在 Studio 中给轨迹设置易读的显示名称。

### 4. 使用关键帧对齐 BLF 与视频

Studio 会同时显示视频预览和多轨 BLF 时间轴：

- 先设置 **全局 BLF 偏移**，建立视频时间与 BLF 时间的基本关系。
- 使用视频进度条，或点击波形，把视频定位到某个明显事件。
- 双击时间轴添加关键帧；选中关键帧后点击 **对齐关键帧**，让该 BLF 事件与当前
  视频帧重合。
- 对错误关键帧可以右键删除，或使用关键帧控制按钮删除。
- 放大时间轴检查细节，完成后恢复全局视图检查整段录制是否存在漂移。
- 如果某条轨迹仍有独立时间差，可以设置方向盘或横摆角速度的独立偏移。

正值轨迹偏移表示该信号在视频中提前显示。所有偏移都会保存到 Studio 工程，并在
导出时继续使用。

### 5. 编辑 Overlay 并导出

完成对齐后点击 **进入 Overlay 编辑**。Studio 与 Overlay 编辑器会复用已经读取的
轨迹，不会因为页面切换而重新读取整个 BLF。添加、调整卡片并预览后，在导出页面
选择区间并生成视频。

没有 GoPro/GPMF 遥测信息的视频也可以直接使用 BLF 手动对齐；视频元数据不是该流程
的必需条件。

## 其他遥测数据源

传统的 **Data** 页面仍支持以下数据源：

| 数据源 | 常见文件 |
| --- | --- |
| RaceBox | `.csv` |
| AIM MyChron | `.xrk`、`.xrz`、`.drk` |
| MoTeC | `.ld` |
| GPX | `.gpx` |
| VBOX | `.vbo` |
| Unipro Laptimer | `.tsv`、`.uni` |

这些数据源使用原有的 Session/圈次工作流；Studio 是专门的 BLF/DBC 工作流，不需要
先把 BLF 转换成普通 CSV。

## 从源码运行

需要 Python 3.10 或更高版本。依赖中包含 BLF/DBC 解析库（`python-can` 和
`cantools`）、科学计算库、pywebview，以及源码安装所需的 FFmpeg：

```bash
git clone https://github.com/playchess2005/OpenLap-SiverShark.git
cd OpenLap-SiverShark
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1
# macOS/Linux：source .venv/bin/activate

python -m pip install --upgrade pip
pip install -e .
python main.py
```

如需 RaceBox 云端下载功能：

```bash
pip install -e ".[racebox-download]"
playwright install chromium
```

Windows 用户也可以从本仓库的 [Releases](https://github.com/playchess2005/OpenLap-SiverShark/releases)
页面下载安装包或便携版。

## 项目归属与致谢

本仓库由 **playchess2005** 维护和发布，基于原作者
[LaurensVR3/OpenLap](https://github.com/LaurensVR3/OpenLap/tree/main) 开发。
发布修改后的源代码或二进制文件时，请保留原项目版权声明、许可证文本和第三方组件
许可信息。

## 许可证

OpenLap 使用 [GNU General Public License v3.0 or later](LICENSE) 发布。
