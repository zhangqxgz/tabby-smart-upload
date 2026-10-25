/**
 * tabby-smart-upload 构建配置
 * 参照 Tabby-SFTP-Plus 的已验证模式：
 *   - target node + commonjs2（插件在 Electron renderer 的 Node 上下文加载）
 *   - tabby-* / @angular / @ng-bootstrap / rxjs 全部 external，运行时共享宿主实例
 *   - 模板与样式全部内联在 .ts 里（template/styles 字符串），零 loader 依赖
 */
const path = require('path')

module.exports = {
  target: 'node',
  entry: 'src/index.ts',
  devtool: 'source-map',
  context: __dirname,
  mode: process.env.NODE_ENV === 'development' ? 'development' : 'production',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: 'webpack-tabby-smart-upload:///[resource-path]',
  },
  resolve: {
    modules: ['.', 'src', 'node_modules'].map(x => path.join(__dirname, x)),
    extensions: ['.ts', '.js', '.json'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          configFile: path.resolve(__dirname, 'tsconfig.json'),
        },
      },
    ],
  },
  externals: [
    'fs',
    'path',
    'os',
    'crypto',
    'net',
    'stream',
    'readline',
    'electron',
    'electron-promise-ipc',
    /^rxjs/,
    /^@angular(?!\/common\/locales)/,
    /^@ng-bootstrap/,
    /^tabby-/,
  ],
}
