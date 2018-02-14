const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const express = require('express')
const helmet = require('helmet')
const session = require('express-session')
const MemoryStore = require('memorystore')(session)
const configUtil = require('./lib/config')
const db = require('./lib/db')
const packageJson = require('../package.json')
const {
  baseUrl,
  googleClientId,
  googleClientSecret,
  publicUrl,
  debug
} = require('./lib/config').getPreDbConfig()

/*  Express setup
============================================================================= */
const bodyParser = require('body-parser')
const favicon = require('serve-favicon')
const morgan = require('morgan')
const passport = require('passport')
const errorhandler = require('errorhandler')

const app = express()

// Use default helmet protections and add referrerPolicy
app.use(helmet())
app.use(helmet.referrerPolicy({ policy: 'same-origin' }))

app.set('env', debug ? 'development' : 'production')

if (debug) {
  app.use(errorhandler())
}
app.use(favicon(path.join(__dirname, '../public/images/favicon.ico')))
app.use(bodyParser.json())
app.use(
  bodyParser.urlencoded({
    extended: true
  })
)

// Cookie secrets are generated randomly at server start
// SQLPad (currently) is designed for running as a single instance
// so this should be okay unless SQLPad is frequently restarting
const cookieSecrets = [1, 2, 3, 4].map(n =>
  crypto.randomBytes(64).toString('hex')
)
const ONE_HOUR = 1000 * 60 * 60
app.use(
  session({
    store: new MemoryStore({
      checkPeriod: ONE_HOUR
    }),
    saveUninitialized: false,
    resave: false,
    rolling: true,
    cookie: { maxAge: ONE_HOUR },
    secret: cookieSecrets
  })
)

app.use(passport.initialize())
app.use(passport.session())
app.use(baseUrl, express.static(path.join(__dirname, '../build')))
if (debug) {
  app.use(morgan('dev'))
}

// Add config helper to req
app.use(function(req, res, next) {
  configUtil
    .getHelper(db)
    .then(config => {
      req.config = config
      next()
    })
    .catch(error => {
      console.error('Error getting config helper', error)
      next(error)
    })
})

/*  Passport setup
============================================================================= */
require('./middleware/passport.js')

/*  Routes
============================================================================= */
const routers = [
  require('./routes/homepage.js'),
  require('./routes/app.js'),
  require('./routes/version.js'),
  require('./routes/users.js'),
  require('./routes/forgot-password.js'),
  require('./routes/password-reset.js'),
  require('./routes/connections.js'),
  require('./routes/queries.js'),
  require('./routes/query-result.js'),
  require('./routes/download-results.js'), // streams result download to browser
  require('./routes/schema-info.js'),
  require('./routes/config-values.js'),
  require('./routes/tags.js'),
  require('./routes/signup-signin-signout.js')
]

if (googleClientId && googleClientSecret && publicUrl) {
  if (debug) {
    console.log('Enabling Google authentication Strategy.')
  }
  routers.push(require('./routes/oauth.js'))
}

routers.forEach(function(router) {
  app.use(baseUrl, router)
})

// For any missing api route, return a 404
app.use(baseUrl + '/api/', function(req, res) {
  console.log('reached catch all api route')
  res.sendStatus(404)
})

// Anything else should render the client-side app
// Client-side routing will take care of things from here
// index-template.html generated by create-react-app must consider baseUrl
const htmlPath = path.join(__dirname, '../build/index-template.html')
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8')
  const baseUrlHtml = html
    .replace(/="\/stylesheets/g, `="${baseUrl}/stylesheets`)
    .replace(/="\/javascripts/g, `="${baseUrl}/javascripts`)
    .replace(/="\/images/g, `="${baseUrl}/images`)
    .replace(/="\/fonts/g, `="${baseUrl}/fonts`)
    .replace(/="\/static/g, `="${baseUrl}/static`)
  app.use((req, res) => res.send(baseUrlHtml))
} else {
  console.error('\nNO FRONT END TEMPLATE DETECTED')
  console.error('If not running in dev mode please report this issue.\n')
}

module.exports = app