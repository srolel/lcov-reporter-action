import { promises as fs } from "fs"
import core from "@actions/core"
import { GitHub, context } from "@actions/github"

import { parse } from "./lcov"
import { diff } from "./comment"

async function main() {
	const token = core.getInput("github-token")
	const lcovFile = core.getInput("lcov-file") || "./coverage/lcov.info"
	const baseFile = core.getInput("lcov-base")

	const raw = await fs.readFile(lcovFile, "utf-8").catch(err => null)
	if (!raw) {
		console.log(`No coverage report found at '${lcovFile}', exiting...`)
		return
	}

	const baseRaw =
		baseFile && (await fs.readFile(baseFile, "utf-8").catch(err => null))
	if (baseFile && !baseRaw) {
		console.log(`No coverage report found at '${baseFile}', ignoring...`)
	}

	const options = {
		repository: context.payload.repository.full_name,
		prefix: `${process.env.GITHUB_WORKSPACE}/`,
	}

	if (context.eventName === "pull_request") {
		options.commit = context.payload.pull_request.head.sha
		options.head = context.payload.pull_request.head.ref
		options.base = context.payload.pull_request.base.ref
	} else if (context.eventName === "push") {
		options.commit = context.payload.after
		options.head = context.ref
	}

	const lcov = await parse(raw)
	const baselcov = baseRaw && (await parse(baseRaw))
	const body = diff(lcov, baselcov, options)

	const gh = new GitHub(token)

	if (context.eventName === "pull_request") {
		const comments = await gh.issues.listComments({
			repo: context.repo.repo,
			owner: context.repo.owner,
			issue_number: context.payload.pull_request.number,
		})

		const botComment = comments.data.find(
			({ user, body }) => user.id === 41898282 && body.startsWith("Coverage "),
		)

		if (botComment) {
			gh.issues.updateComment({
				repo: context.repo.repo,
				owner: context.repo.owner,
				issue_number: context.payload.pull_request.number,
				body,
				comment_id: botComment.id,
			})
		} else {
			gh.issues.createComment({
				repo: context.repo.repo,
				owner: context.repo.owner,
				issue_number: context.payload.pull_request.number,
				body,
			})
		}
	} else if (context.eventName === "push") {
		gh.repos.createCommitComment({
			repo: context.repo.repo,
			owner: context.repo.owner,
			commit_sha: options.commit,
			body,
		})
	}
}

main().catch(function(err) {
	console.log(err)
	core.setFailed(err.message)
})
