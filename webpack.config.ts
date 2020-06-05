import path from 'path'
import { CleanWebpackPlugin } from 'clean-webpack-plugin'
import CopyPlugin from 'copy-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin'
import WebpackMessages from 'webpack-messages'
import { DefinePlugin } from 'webpack'
import { execSync } from 'child_process'
import { padStart } from 'lodash'
import _ from 'lodash'
const ExtensionReloader = require('webpack-extension-reloader')

module.exports = (env: any, argv: any) => {
  const dev = argv.mode === 'development'
  const commit = execSync('git rev-parse HEAD').toString().trim()

  return {
    entry: {
      content: './src/content.tsx',
      background: './src/background.ts',
      popup: './src/popup.tsx',
    },
    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, dev ? 'dist-dev' : 'dist-prod'),
    },
    // The default source map uses eval, which violates some browser CSP
    ...(dev ? { devtool: 'inline-source-map' } : {}),
    plugins: _.compact([
      new CleanWebpackPlugin({
        // Otherwise it deletes CopyPlugin's files on each build
        cleanStaleWebpackAssets: false,
      }),
      dev ? new ExtensionReloader({ entries: { contentScript: 'content' } }) : undefined,
      new CopyPlugin([
        {
          from: 'manifest.json',
          transform: buffer => {
            const manifest = JSON.parse(buffer.toString())
            const now = new Date()

            const n2 = (n: number) => padStart(n.toString(), 2, '0')
            const y = now.getUTCFullYear()
            const mo = now.getUTCMonth() + 1
            const d = now.getUTCDate()
            const h = now.getUTCHours()
            const min = now.getUTCMinutes()
            const s = now.getUTCSeconds()
            const minuteOftsay = h * 60 + min

            manifest['version'] = `${y}.${mo}.${d}.${minuteOftsay}`
            manifest['version_name'] = `${y}-${n2(mo)}-${n2(d)}T${n2(h)}:${n2(min)}:${n2(s)}Z ${commit.slice(0, 7)}`

            return JSON.stringify(manifest, null, 2)
          },
        },
        { from: 'icon-128.png' },
        { from: 'src/roboto.css' },
        { from: 'src/custom.css' },
        { from: 'node_modules/tippy.js/dist/tippy.css' },
        { from: 'node_modules/tippy.js/themes/light-border.css' },
        { from: 'node_modules/highlight.js/styles/github.css' },
      ]),
      new HtmlWebpackPlugin({
        title: 'CodeWyng',
        template: 'src/popup.html',
        filename: 'popup.html',
        chunks: ['popup'],
      }),
      new ForkTsCheckerWebpackPlugin({ async: false }),
      new WebpackMessages(),
      new DefinePlugin({
        SERVER_URL: JSON.stringify(dev ? process.env['CODEWYNG_URL'] : 'https://api.codewyng.io'),
        DEV: JSON.stringify(true),
      }),
    ]),
    devServer: {
      contentBase: './dist-dev',
      writeToDisk: true,
      // hot and inline cause a crash loop in the browser extension
      hot: false,
      inline: false,
    },
    // less noise
    stats: 'errors-only',
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts(x?)$/,
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { node: true } }],
              '@babel/preset-typescript',
              '@babel/preset-react',
            ],
          },
        },
        {
          test: /\.(png|jpe?g|gif)$/i,
          use: [
            {
              loader: 'file-loader',
            },
          ],
        },
        {
          test: /\.svg$/,
          use: [
            {
              loader: '@svgr/webpack',
            },
          ],
        },
      ],
    },
    watchOptions: {
      ignored: /node_modules/,
    },
  }
}
