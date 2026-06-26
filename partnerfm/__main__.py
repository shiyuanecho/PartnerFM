"""PartnerFM CLI entry point — ``partnerfm`` 命令。"""

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(
        prog='partnerfm',
        description='PartnerFM — 本地 AI 工作台，集文件管理、模型配置、AI 对话于一体。',
    )
    parser.add_argument(
        '--host', default='127.0.0.1',
        help='绑定地址 (默认: 127.0.0.1)')
    parser.add_argument(
        '-p', '--port', type=int, default=8765,
        help='端口号 (默认: 8765)')
    parser.add_argument(
        '--data-dir', default=None,
        help='数据目录 (默认: pip 安装 → ~/.partnerfm/；源码运行 → 项目根)')
    parser.add_argument(
        '-o', '--open', dest='open_browser', action='store_true', default=True,
        help='自动打开浏览器 (默认)')
    parser.add_argument(
        '--no-open', dest='open_browser', action='store_false',
        help='不自动打开浏览器')

    args = parser.parse_args()

    from partnerfm.server import run_server
    run_server(
        host=args.host,
        port=args.port,
        data_dir=args.data_dir,
        open_browser=args.open_browser,
    )


if __name__ == '__main__':
    main()
