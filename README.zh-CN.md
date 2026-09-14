# OpenLap-SiverShark

OpenLap-SiverShark 是一个免费的开源赛车遥测视频叠加工具，可将 RaceBox、AIM MyChron、MoTeC、GPX、VBOX 和 Unipro Laptimer 等设备记录的遥测数据同步并叠加到赛车视频中。

本项目是在 [OpenLap](https://github.com/LaurensVR3/OpenLap) 基础上的独立衍生项目，由 SiverShark 持续开发和维护。

## 主要功能

- 支持多种遥测数据源和常见文件格式
- 自动扫描 Session、匹配视频并同步时间
- 可视化 Overlay 编辑器，支持多种仪表和主题
- 支持 GPU 编码及 CPU 编码回退
- 支持单圈、最快圈、全部圈次和完整 Session 导出
- 支持自定义 `styles` 插件

## Windows 使用

下载发布页中的安装包，或解压便携版后运行 `OpenLap.exe`。首次启动进入 **Settings** 设置遥测数据、视频和导出目录，然后依次在 **Data** 扫描 Session、在 **Overlay** 编辑布局、在 **Export** 导出视频。

## 支持的数据格式

| 数据源 | 文件格式 |
| --- | --- |
| RaceBox | `.csv` |
| AIM MyChron | `.xrk`、`.xrz`、`.drk` |
| MoTeC | `.ld` |
| GPX | `.gpx` |
| VBOX | `.vbo` |
| Unipro Laptimer | `.tsv`、`.uni` |

Unipro 数据优先使用 `.tsv`，其中包含更完整的通道和圈次信息。

## 从源码运行

需要 Python 3.10+ 和 FFmpeg：

```bash
git clone https://github.com/playchess2005/OpenLap-SiverShark.git
cd OpenLap-SiverShark
pip install -e .
python main.py
```

## 构建 Windows 程序

```bash
pip install -e ".[package,racebox-download]"
playwright install chromium
pyinstaller OpenLap.spec
```

构建结果位于 `dist/OpenLap/`，运行时请保持 exe 与 `_internal` 文件夹在一起。

## 许可证与来源

本项目依据 **GPL-3.0-or-later** 发布。请保留原项目版权声明、许可证文本和第三方组件许可信息；发布修改后的二进制程序时，也请提供对应源代码。

- 原项目：[LaurensVR3/OpenLap](https://github.com/LaurensVR3/OpenLap)
- 当前项目：[playchess2005/OpenLap-SiverShark](https://github.com/playchess2005/OpenLap-SiverShark)
- 许可证：[LICENSE](LICENSE)
