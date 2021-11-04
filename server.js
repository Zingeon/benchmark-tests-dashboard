const fastify = require('fastify')({ logger: true })
const path = require('path');
const axios = require('axios');
const crypto = require("crypto");
const child_process = require('child_process');
const fs = require('fs-extra');
const isRunning = require('is-running');
require('dotenv').config();

const frontendBasicAuthUser = process.env.FRONTEND_BASIC_AUTH_USER;
const frontendBasicAuthPassword = process.env.FRONTEND_BASIC_AUTH_PASSWORD;

axios.interceptors.request.use(function (config) {
    config.metadata = { startTime: new Date()}
    return config;
}, function (error) {
    return Promise.reject(error);
});

axios.interceptors.response.use(function (response) {
    response.config.metadata.endTime = new Date()
    response.responseTime = response.config.metadata.endTime - response.config.metadata.startTime
    return response;
}, function (error) {
    error.config.metadata.endTime = new Date();
    error.responseTime = error.config.metadata.endTime - error.config.metadata.startTime;
    return Promise.reject(error);
});

fastify.register(require('fastify-formbody'));
fastify.register(require('point-of-view'), {
    engine: {
        mustache: require('mustache'),
    },
    templates: 'templates',
});

const partials = {
    partials: {
        header: 'header.mustache'
    }
};

fastify.register(require('fastify-static'), {
    root: path.join(__dirname, '/css'),
    prefix: '/css',
    decorateReply: false,
});
fastify.register(require('fastify-static'), {
    root: path.join(__dirname, '/js'),
    prefix: '/js',
    decorateReply: false,
});

const frontendUriStore = require('data-store')({path: process.cwd() + '/web/frontend_uri.json'});
const apiUriStore = require('data-store')({path: process.cwd() + '/web/api_uri.json'});
const frontendReportPidStore = require('data-store')({path: process.cwd() + '/web/frontend_report_pid.json'});
const apiReportPidStore = require('data-store')({path: process.cwd() + '/web/api_report_pid.json'});

const getFrontendUriList = () => {
    const items = new Map(Object.entries(frontendUriStore.get()));
    items.forEach((value, name) => value.name = name);

    return items;
}

let frontendUriList = getFrontendUriList();

const getApiUriList = () => {
    const items = new Map(Object.entries(apiUriStore.get()));
    items.forEach((value, name) => value.name = name);

    return items;
}

let apiUriList = getApiUriList();

const getFrontendReportPidList = () => {
    const items = new Map(Object.entries(frontendReportPidStore.get()));
    items.forEach((value, name) => value.name = name);

    return items;
}

let frontendReportPidList = getFrontendReportPidList();

const getApiReportPidList = () => {
    const items = new Map(Object.entries(apiReportPidStore.get()));
    items.forEach((value, name) => value.name = name);

    return items;
}

let apiReportPidList = getApiReportPidList();

fastify.post('/frontend', (req, reply) => {
    const name = req.body.name;
    const uri = req.body.uri;

    if (name !== "") {
        const project = Object.assign({},
            name && {"name": name},
            uri && {"uri": uri},
        );

        frontendUriStore.set(name, project);

        frontendUriList = getFrontendUriList();
    }

    reply.redirect(302, '/frontend');
});

fastify.post('/api', async (req, reply) => {
    const name = req.body.name;
    const uri = req.body.uri;

    if (name !== "") {
        const project = Object.assign({},
            name && {"name": name},
            uri && {"uri": uri},
        );

        apiUriStore.set(name, project);

        apiUriList = getApiUriList();
    }

    reply.redirect(302, '/api');
})

fastify.get('/', (req, reply) => {
    reply.view('home.mustache', {}, {...partials});
});

fastify.get('/frontend', async (req, reply) => {
    const uriName = req.query.name;
    let selectedUri = {};

    if (frontendUriList.has(uriName)) {
        selectedUri = frontendUriList.get(uriName);
    }

    reply.view('dashboard.mustache', {
        type: 'frontend',
        name: 'Frontend',
        projects: Array.from(frontendUriList.values()),
        selectedUri: selectedUri,
        formTitle: Object.entries(selectedUri).length === 0 ? 'Add frontend uri' : 'Edit frontend uri',
    }, {...partials});
})

fastify.get('/frontend/run', async (req, reply) => {
    const reportId = crypto.randomBytes(16).toString("hex");
    const reportPath = process.cwd() + '/web/reports/frontend/report-' + reportId + '.json';
    fs.ensureFile(reportPath)
    const child = child_process.fork('./processFrontendReport.js', [JSON.stringify(Array.from(frontendUriList.values())), reportPath]);
    frontendReportPidStore.set(reportId, {pid: child.pid})
    frontendReportPidList = getFrontendReportPidList()

    reply.send({reportId});
})

fastify.get('/api/run', async (req, reply) => {
    const reportId = crypto.randomBytes(16).toString("hex");
    const reportPath = process.cwd() + '/web/reports/api/report-' + reportId + '.json';
    fs.ensureFile(reportPath)
    const child = child_process.fork('./processApiReport.js', [JSON.stringify(Array.from(apiUriList.values())), reportPath]);
    apiReportPidStore.set(reportId, {pid: child.pid})
    apiReportPidList = getApiReportPidList()

    reply.send({reportId});
})

function isJsonString(str) {
    try {
        JSON.parse(str);
    } catch (e) {
        return false;
    }
    return true;
}

fastify.get('/frontend/report/:reportId', async (req, reply) => {
    const reportId = req.params.reportId;

    const reportPath = process.cwd() + '/web/reports/frontend/report-' + reportId + '.json';
    if (!reportId || !fs.existsSync(reportPath) || !frontendReportPidList.has(reportId)) {
        reply.code(404);
        reply.send({status: 'Report not found'});
        return;
    }

    const selectedPid = frontendReportPidList.get(reportId);
    if (isRunning(selectedPid.pid)) {
        reply.send({status: 'In progress'});
        return;
    }

    const data = fs.readFileSync(reportPath, 'utf8')
    if (!isJsonString(data) ) {
        reply.send({status: 'Corrupted data'});
        return;
    }

    const report = JSON.parse(data);
    reply.code(200);
    reply.send(report);
})

fastify.get('/api/report/:reportId', async (req, reply) => {
    const reportId = req.params.reportId;

    const reportPath = process.cwd() + '/web/reports/api/report-' + reportId + '.json';
    if (!reportId || !fs.existsSync(reportPath) || !apiReportPidList.has(reportId)) {
        reply.code(404);
        reply.send({status: 'Report not found'});
        return;
    }

    const selectedPid = apiReportPidList.get(reportId);
    if (isRunning(selectedPid.pid)) {
        reply.send({status: 'In progress'});
        return;
    }

    const data = fs.readFileSync(reportPath, 'utf8')
    if (!isJsonString(data) ) {
        reply.send({status: 'Corrupted data'});
        return;
    }

    const report = JSON.parse(data);
    reply.code(200);
    reply.send(report);
})

fastify.get('/frontend/report/:reportId/status', async (req, reply) => {
    const reportId = req.params.reportId;

    const reportPath = process.cwd() + '/web/reports/frontend/report-' + reportId + '.json';
    if (!reportId || !fs.existsSync(reportPath) || !frontendReportPidList.has(reportId)) {
        reply.code(404);
        reply.send({status: 'Report not found'});
        return;
    }

    const data = fs.readFileSync(reportPath, 'utf8')
    if (data.length === 0) {
        reply.send({status: 'In progress'});
        return;
    }

    if (!isJsonString(data) ) {
        reply.send({status: 'Corrupted data'});
        return;
    }
    reply.send({status: 'Done'});
})

fastify.get('/api/report/:reportId/status', async (req, reply) => {
    const reportId = req.params.reportId;

    const reportPath = process.cwd() + '/web/reports/api/report-' + reportId + '.json';
    if (!reportId || !fs.existsSync(reportPath) || !apiReportPidList.has(reportId)) {
        reply.code(404);
        reply.send({status: 'Report not found'});
        return;
    }

    const data = fs.readFileSync(reportPath, 'utf8')
    if (data.length === 0) {
        reply.send({status: 'In progress'});
        return;
    }

    if (!isJsonString(data) ) {
        reply.send({status: 'Corrupted data'});
        return;
    }
    reply.send({status: 'Done'});
})

fastify.get('/api', async (req, reply) => {
    const uriName = req.query.name;
    let selectedUri = {};

    if (apiUriList.has(uriName)) {
        selectedUri = apiUriList.get(uriName);
    }

    reply.view('dashboard.mustache', {
        type: 'api',
        name: 'API',
        projects: Array.from(apiUriList.values()),
        selectedUri: selectedUri,
        formTitle: Object.entries(selectedUri).length === 0 ? 'Add API uri' : 'Edit API uri',
    }, {...partials});
})

fastify.get('/frontend/list', (req, reply) => {
    reply.send(Array.from(frontendUriList.values()));
});

fastify.get('/api/list', (req, reply) => {
    reply.send(Array.from(apiUriList.values()));
});

fastify.get('/frontend/benchmark', (req, reply) => {
    const uriName = req.query.name;

    let selectedUri = {};

    if (frontendUriList.has(uriName)) {
        selectedUri = frontendUriList.get(uriName);
    }

    axios.get(selectedUri.uri,
        {
            auth: {
                username: frontendBasicAuthUser,
                password: frontendBasicAuthPassword
            }
        })
        .then(function (response) {
            reply.code(200);
            reply.send({'responseTime': response.responseTime});
        })
        .catch(function (error) {
            console.log(error);
        });
});

fastify.get('/api/benchmark', (req, reply) => {
    const uriName = req.query.name;

    let selectedUri = {};

    if (apiUriList.has(uriName)) {
        selectedUri = apiUriList.get(uriName);
    }

    axios.get(selectedUri.uri,
        {
            headers: {
                "Merchant-Reference": '474-001',
            }
        })
        .then(function (response) {
            reply.code(200);
            reply.send({'responseTime': response.responseTime});
        })
        .catch(function (error) {
            console.log(error);
        });
});

fastify.delete('/frontend', (req, reply) => {
    const name = req.query.name;
    let statusCode = 404;

    if (frontendUriStore.has(name)) {
        frontendUriStore.del(name);
        frontendUriList = getFrontendUriList();
        statusCode = 200;
    }

    reply.code(statusCode);
    reply.send('');
});

fastify.delete('/api', (req, reply) => {
    const name = req.query.name;
    let statusCode = 404;

    if (apiUriStore.has(name)) {
        apiUriStore.del(name);
        apiUriList = getApiUriList();
        statusCode = 200;
    }

    reply.code(statusCode);
    reply.send('');
});

const start = async () => {

    try {
        await fastify.listen(3001);
        fastify.log.info(`server listening on ${fastify.server.address().port}`)
    } catch (err) {
        fastify.log.error(err);
    }
};

start();
