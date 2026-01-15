import { Effect } from 'effect'
import { type ApiError, GerritApiService } from '@/api/gerrit'

interface ProjectsOptions {
  pattern?: string
  xml?: boolean
}

/**
 * Lists Gerrit projects with optional pattern filtering.
 *
 * @param options - Configuration options
 * @param options.pattern - Optional regex pattern to filter projects by name
 * @param options.xml - Whether to output in XML format for LLM consumption
 * @returns Effect that completes when projects are listed
 */
export const projectsCommand = (
  options: ProjectsOptions = {},
): Effect.Effect<void, ApiError, GerritApiService> =>
  Effect.gen(function* () {
    const gerritApi = yield* GerritApiService

    // Fetch projects
    const projects = yield* gerritApi.listProjects({
      pattern: options.pattern,
    })

    // Handle empty results
    if (projects.length === 0) {
      if (options.xml) {
        console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
        console.log(`<projects_result>`)
        console.log(`  <status>success</status>`)
        console.log(`  <projects />`)
        console.log(`</projects_result>`)
      } else {
        console.log('No projects found')
      }
      return
    }

    // Output results
    if (options.xml) {
      console.log(`<?xml version="1.0" encoding="UTF-8"?>`)
      console.log(`<projects_result>`)
      console.log(`  <status>success</status>`)
      console.log(`  <projects>`)
      for (const project of projects) {
        console.log(`    <project>`)
        console.log(`      <id>${project.id}</id>`)
        console.log(`      <name>${project.name}</name>`)
        if (project.parent) {
          console.log(`      <parent>${project.parent}</parent>`)
        }
        if (project.state) {
          console.log(`      <state>${project.state}</state>`)
        }
        console.log(`    </project>`)
      }
      console.log(`  </projects>`)
      console.log(`</projects_result>`)
    } else {
      // Plain text output - one project name per line
      for (const project of projects) {
        console.log(project.name)
      }
    }
  })
