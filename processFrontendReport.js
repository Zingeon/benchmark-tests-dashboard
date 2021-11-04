const axios = require('axios');
const fs = require('fs-extra');
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

const frontendUriList = JSON.parse(process.argv[2]);
const reportPath = process.argv[3];
const report = {};

processBenchmark(frontendUriList);

async function processBenchmark(frontendUriList) {
    for (const uriItem of frontendUriList) {
        await performRequest(uriItem);
    }

    fs.writeJson(reportPath, JSON.parse(JSON.stringify(report))).catch(err => {
        console.error(err)
    })
}

async function performRequest(item) {
    console.log(item.name)
    await axios.get(item.uri,

        {
            auth: {
                username: frontendBasicAuthUser,
                password: frontendBasicAuthPassword
            }
        })
        .then(function (response) {
            report[item.name] = {
                "responseTime": response.responseTime,
                "uri": item.uri
            }
        })
        .catch(function (error) {
            console.log(error);
        });
}
