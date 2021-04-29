import React from 'react'
import ReactDOM from 'react-dom'
import { browser } from 'webextension-polyfill-ts'

import { Typography } from '@material-ui/core'
import { examples } from './common'

declare const DEV: boolean | undefined

const IndexPage = () => (
  <div style={{ padding: '0px 10px' }}>
    <Typography component={'span'} variant="body1">
      <div>
        Just installed?Try hovering over variables in:
        <ul>
          {examples.map(e => (
            <li key={e.url}>
              {e.language} example{' '}
              <a href={e.url} onClick={async () => await browser.tabs.create({ url: e.url })}>
                {e.linktext}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Typography>
    {/* <Typography>Pro features</Typography>
        <AccessToken /> */}
  </div>
)

ReactDOM.render(<IndexPage />, document.getElementById('container'))
