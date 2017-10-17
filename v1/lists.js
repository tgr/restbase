'use strict';

const P = require('bluebird');
const mwUtil = require('../lib/mwUtil');
const HyperSwitch = require('hyperswitch');
const URI = HyperSwitch.URI;
const spec = HyperSwitch.utils.loadSpec(`${__dirname}/lists.yaml`);

class ReadingLists {
    /**
     * Transform the continuation data into a string so it is easier for clients to deal with.
     * @param {!Object|undefined} continuation Continuation object returned by the MediaWiki API.
     * @return {!String|undefined} Continuation string.
     */
    flattenContinuation(continuation) {
        return JSON.stringify(continuation);
    }

    /**
     * Inverse of flattenContinuation.
     * @param {!String|undefined} continuation Continuation string returned by flattenContinuation()
     * @return {!Object} Continuation object.
     */
    unflattenContinuation(continuation) {
        const sanitizedContinuation = {};
        if (typeof continuation === 'string') {
            try {
                continuation = JSON.parse(continuation);
            } catch (e) {
                this.options.log('error/unflatten', {
                    msg: e.message,
                    json: continuation,
                });
                throw e;
            }
            // Make sure nothing malicious can be done by splicing the continuation data
            // into the API parameters.
            const allowedKeys = ['continue', 'rlcontinue', 'rlecontinue'];
            for (const key of allowedKeys) {
                if (typeof continuation[key] !== 'object') {
                    sanitizedContinuation[key] = continuation[key];
                }
            }
        }
        return sanitizedContinuation;
    }

    /**
     * Convert an array of values into the format expected by the MediaWiki API.
     * @param {!Array} list A list containing strings and numbers.
     * @return {!String}
     */
    flattenMultivalue(list) {
        return list.join('|');
    }

    /**
     * Handle the /list/{id}/entries endpoint (get entries of a list).
     * @param {!HyperSwitch} hyper
     * @param {!Object} req The request object as provided by HyperSwitch.
     * @return {!Promise<Object>} A response promise.
     */
    getListEntries(hyper, req) {
        return hyper.post({
            uri: new URI([req.params.domain, 'sys', 'action', 'rawquery']),
            body: {
                action: 'query',
                list: 'readinglistentries',
                rlelists: req.params.id,
                rlelimit: 'max',
                continue: this.unflattenContinuation(req.query.next).continue,
                rlecontinue: this.unflattenContinuation(req.query.next).rlecontinue,
            },
        })
        .then((res) => {
            const entries = res.body.query.readinglistentries;
            const next = this.flattenContinuation(res.body.continue);

            return this.hydrateSummaries({
                status: 200,
                headers: {
                    'content-type': 'application/json; charset=utf-8;'
                        + 'profile="https://www.mediawiki.org/wiki/Specs/Lists/0.1"',
                    'cache-control': 'no-cache',
                },
                body: {
                    entries,
                    next,
                }
            }, hyper, req);
        });
    }

    /**
     * Add data from the summary endpoint to an array of list entries.
     * @param {!Object} res Response object.
     * @param {!HyperSwitch} hyper
     * @param {!Object} req The request object as provided by HyperSwitch.
     * @return {!Promise<Array>} The objects, enriched with summaries.
     */
    hydrateSummaries(res, hyper, req) {
        return P.map(res.body.entries, (entry) => {
            return mwUtil.getSiteInfo(hyper, req, entry.project).then((siteinfo) => {
                entry.$merge = [
                    `${siteinfo.baseUri}/page/summary/${encodeURIComponent(entry.title)}`,
                ];
            }).catch(() => {});
        })
        .then(() => mwUtil.hydrateResponse(res, uri => mwUtil.fetchSummary(hyper, uri)));
    }
}

module.exports = (options) => {
    const rl = new ReadingLists(options);

    return {
        spec,
        globals: {
            options,
            flattenContinuation: rl.flattenContinuation.bind(rl),
            unflattenContinuation: rl.unflattenContinuation.bind(rl),
            flattenMultivalue: rl.flattenMultivalue.bind(rl),
        },
        operations: {
            getListEntries: rl.getListEntries.bind(rl),
        },
    };
};
