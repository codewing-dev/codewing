import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { browser, Events, Storage } from 'webextension-polyfill-ts'
import Visibility from '@material-ui/icons/Visibility'
import VisibilityOff from '@material-ui/icons/VisibilityOff'
import Alert from '@material-ui/lab/Alert'

import { enforceAuth } from './features'
import { setStorage, observeStorage, observeUnderlineVariables, setUnderlineVariables } from './utils'

import firebase from 'firebase/app'
import 'firebase/auth'
import 'firebase/functions'
import 'firebase/firestore'

export const app = firebase.initializeApp({
  apiKey: 'AIzaSyCrwVp9Lw8phXmDAkLlqy5PB4Im-sx8FMU',
  authDomain: 'codewyng.io',
  databaseURL: 'https://codewyng.firebaseio.com',
  projectId: 'codewyng',
  storageBucket: 'codewyng.appspot.com',
  messagingSenderId: '1002785187394',
  appId: '1:1002785187394:web:aa66b86659dd89bafeefdb',
  measurementId: 'G-Y63WHT9TYJ',
})

import GitHubIcon from '@material-ui/icons/GitHub'
import { makeStyles, createMuiTheme, ThemeProvider } from '@material-ui/core/styles'
import { blue } from '@material-ui/core/colors'
import {
  CircularProgress,
  IconButton,
  Tooltip,
  Avatar,
  Button,
  FormControl,
  InputLabel,
  OutlinedInput,
  InputAdornment,
  TextField,
  Input,
  Typography,
} from '@material-ui/core'
import Logo from '../logo.svg'
import ExitToAppIcon from '@material-ui/icons/ExitToApp'
import { fromEvent, fromEventPattern, Observable, concat, from } from 'rxjs'
import { map, filter } from 'rxjs/operators'
import { RequestType, oauthDomains, examples } from './common'
import { useObservable } from 'rxjs-hooks'

const topTheme = createMuiTheme({
  palette: {
    primary: blue,
  },
})

const useStyles = makeStyles(theme => ({
  root: {
    flexGrow: 1,
  },
  signOutButton: {
    marginRight: theme.spacing(1),
  },
  title: {
    flexGrow: 1,
  },
  white: {
    backgroundColor: 'white',
  },
}))

const Row = (props: { children: React.ReactNode }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {props.children}
    </div>
  )
}

const Toolbar = (props: { children: React.ReactNode }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        margin: '10px',
        justifyContent: 'space-between',
        height: '48px',
      }}
    >
      {props.children}
    </div>
  )
}

const Header = (props: { user: firebase.User | 'loading' | null }) => {
  const classes = useStyles()
  const user = props.user

  return (
    <Toolbar>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Logo style={{ height: '40px', width: '40px' }} />
        <div style={{ marginLeft: '10px', fontSize: '25px' }}>
          Code<span style={{ fontWeight: 'bold' }}>Wyng</span>
        </div>
      </div>
      {user === 'loading' ? (
        <CircularProgress />
      ) : firebase && user ? (
        <Row>
          <Tooltip title="Log out">
            <IconButton onClick={() => firebase.auth().signOut()} className={classes.signOutButton}>
              <ExitToAppIcon />
            </IconButton>
          </Tooltip>
          <Avatar alt={user.displayName ?? undefined} src={user.photoURL ?? undefined} />
        </Row>
      ) : firebase ? (
        <>
          {/* <Button
            variant="outlined"
            startIcon={oauthDomains.has(window.location.origin) ? <GitHubIcon /> : null}
            onClick={async () => await browser.runtime.sendMessage({ kind: 'loginToGithub' } as { kind: RequestType })}
            disabled={!oauthDomains.has(window.location.origin)}
          >
            {oauthDomains.has(window.location.origin) ? 'Log in' : 'PREVIEW BUILD'}
          </Button> */}
        </>
      ) : (
        'no firebase'
      )}
    </Toolbar>
  )
}

declare const DEV: boolean | undefined

const AccessToken = () => {
  const [token, setToken] = useState<string | undefined>(undefined)
  const [showToken, setShowToken] = useState<boolean>(false)
  const [dirty, setDirty] = useState<boolean>(false)
  console.log(token)
  useEffect(() => {
    // tslint:disable-next-line: no-floating-promises
    browser.storage.local.get('githubAccessToken').then(({ githubAccessToken }) => setToken(githubAccessToken))
    const listener = (changes: { [s: string]: Storage.StorageChange }): void => {
      if (changes['githubAccessToken']) {
        setToken(changes['githubAccessToken'].newValue)
      }
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'row' }}>
      <TextField
        label="GitHub access token"
        style={{ margin: 8 }}
        placeholder="abc123..."
        fullWidth
        margin="normal"
        InputLabelProps={{
          shrink: true,
        }}
        value={token ?? ''}
        onChange={e => {
          console.log('setting to', e.target.value)
          setToken(e.target.value)
          setDirty(true)
        }}
        type={showToken ? 'text' : 'password'}
        disabled={!DEV}
      />
      <IconButton disabled={!DEV} onClick={() => setShowToken(!showToken)}>
        {showToken ? <Visibility /> : <VisibilityOff />}
      </IconButton>
      <Button
        variant="contained"
        disabled={!DEV || !dirty}
        onClick={async () => {
          await browser.storage.local.set({ githubAccessToken: token })
          setDirty(false)
        }}
      >
        Save
      </Button>
    </div>
  )
}

const IndexPage = () => {
  const [user, setUser] = useState<firebase.User | null | 'loading'>('loading')
  useEffect(() => firebase.auth().onAuthStateChanged(setUser), [])
  const underlines = useObservable<boolean | 'loading'>(() => observeUnderlineVariables, 'loading')

  return (
    <div style={{ padding: '0px 10px' }}>
      <Header user={user} />
      <Typography component={'span'} variant="body1">
        <div>
          Just installed? Try hovering over variables in:
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
          Settings:
          {underlines === 'loading' ? (
            'Loading...'
          ) : (
            <ul>
              <li>
                <input type="checkbox" onChange={() => setUnderlineVariables(!underlines)} checked={underlines} />
                Underline all variables
              </li>
            </ul>
          )}
        </div>
      </Typography>
      {/* <Typography>Pro features</Typography>
      <AccessToken /> */}
    </div>
  )
}

ReactDOM.render(<IndexPage />, document.getElementById('container'))
