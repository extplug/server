const gh = require('gh-got')
const stringify = require('json-stringify-pretty-compact')
const { json, send } = require('micro')
const { authenticator, authRoute } = require('plug-auth-server')

const ghToken = process.env.GITHUB_TOKEN
const ghRepo = 'extplug/faerss'

const engine = authenticator({
  auth: { email: process.env.PLUG_EMAIL, password: process.env.PLUG_PASSWORD },
  secret: Buffer.from(process.env.SECRET, 'hex')
})

function cors (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const corsMethod = req.headers['access-control-request-method']
  if (corsMethod) res.setHeader('Access-Control-Allow-Methods', corsMethod)
  const corsHeaders = req.headers['access-control-request-headers']
  if (corsHeaders) res.setHeader('Access-Control-Allow-Headers', corsHeaders)
}

function tryAuthenticate (params, req, res) {
  if (params.stage === 'token') {
    return engine.getAuthBlurb(params.user)
  } else if (params.stage === 'verify') {
    try {
      return engine.verifyBlurb(params.user)
    } catch (err) {
      return send(res, 403, { status: 'fail', data: [err.message] })
    }
  }
  return send(res, 400, { status: 'fail', data: ['invalid stage'] })
}

function assertUserIsHost (room, user) {
  return Promise.resolve()
}

async function saveRoomSettings (room, user, settings) {
  const filename = `${room}/settings.json`
  const url = `repos/${ghRepo}/contents/${filename}`

  const existingSha = await gh(url).then((response) => {
    if (response.body.type === 'file') return response.body.sha
    throw new Error('Invalid repository state. Please poke @ReAnna in the plug.dj Discord.')
  }, () => undefined)

  await gh(url, {
    token: ghToken,
    method: 'PUT',
    body: {
      message: `Update room settings for https://plug.dj/${room}.`,
      author: {
        name: user.username,
        email: `user.${user.id}@extplug.com`
      },
      committer: {
        name: 'ExtPlug Bot',
        email: 'd@extplug.com'
      },
      content: Buffer.from(stringify(settings), 'utf8').toString('base64'),
      sha: existingSha
    }
  })

  return { url: `https://rawgit.com/${ghRepo}/master/${filename}` }
}

module.exports = async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') {
    return send(res, 204, null)
  }

  const params = await json(req)
  if (req.url === '/auth') {
    return tryAuthenticate(params, req, res)
  }

  if (req.method === 'PUT') {
    const authHeader = req.headers.authorization
    if (!/^JWT /.test(authHeader)) {
      throw new Error('No authentication token received')
    }

    const roomName = req.url.slice(1)

    const user = await engine.verifyToken(authHeader.slice(4))
    await assertUserIsHost(roomName, user)
    const result = await saveRoomSettings(roomName, user, params)

    return send(res, 200, result)
  }
}