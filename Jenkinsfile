pipeline {
  agent any

  environment {
    REGISTRY_URL    = 'https://ghcr.io'
    GH_NAMESPACE    = 'aadarsh0507'
    GH_OWNER        = 'aadarsh0507'
    // Hardcoded to match the GitHub repo name exactly — avoids underscore/case
    // mismatch where RAW_REPO was 'gg-implants' but image ended up as a different slug.
    IMAGE_NAME      = 'gg-cathlab'
    DOCKER_BUILDKIT = '1'
    GIT_CRED_ID     = 'Jenkins'
    SONAR_TOKEN_ID  = 'sonar-token'
    TRIVY_SEV_MAIN  = 'CRITICAL'
    TRIVY_SEV_DEV   = 'CRITICAL'
  }

  options { timestamps() }

  triggers {
    pollSCM('H/2 * * * *')
  }

  stages {
    stage('Checkout') {
      steps {
        checkout([
          $class: 'GitSCM',
          branches: [[name: '*/main']],
          userRemoteConfigs: scm.userRemoteConfigs,
          extensions: scm.extensions
        ])
        script {
          def rawBranch = env.GIT_BRANCH ?: sh(returnStdout: true, script: 'git rev-parse --abbrev-ref HEAD').trim()
          def normalized = rawBranch.replaceFirst(/^origin\/?/, '')
          env.BRANCH_NAME = normalized ?: 'main'
          echo "Active git branch: ${env.BRANCH_NAME} (raw: ${rawBranch})"
        }
      }
    }

    /* ---------- 1) SonarQube code scan ---------- */
    stage('Sonar Scan') {
      when {
        expression { env.BRANCH_NAME in ['main', 'dev', 'aadarsh'] }
      }
      steps {
        script {
          def scannerHome = tool name: 'sonar-scanner',
                                 type: 'hudson.plugins.sonar.SonarRunnerInstallation'
          def rawRepo = sh(returnStdout:true,
                           script:"basename -s .git \$(git config --get remote.origin.url)").trim()
          def sqKey   = rawRepo.replaceAll('[^A-Za-z0-9:_\\-\\.]','-')
          withSonarQubeEnv('sonar') {
            if (fileExists('sonar-project.properties')) {
              sh """
                ${scannerHome}/bin/sonar-scanner \
                  -Dproject.settings=sonar-project.properties \
                  -Dsonar.scm.provider=git \
                  -Dsonar.scm.forceReloadAll=true
              """
            } else {
              sh """
                ${scannerHome}/bin/sonar-scanner \
                  -Dsonar.projectKey=${sqKey} \
                  -Dsonar.projectName=${rawRepo} \
                  -Dsonar.sources=backend,frontend \
                  -Dsonar.exclusions=**/node_modules/**,**/build/**,**/dist/**,**/*.min.js,**/*.map,**/.env,**/*.env \
                  -Dsonar.sourceEncoding=UTF-8 \
                  -Dsonar.scm.provider=git \
                  -Dsonar.scm.forceReloadAll=true
              """
            }
          }
        }
      }
    }

    /* ---------- 2) Sonar Quality Gate ---------- */
    stage('Quality Gate') {
      when {
        expression { env.BRANCH_NAME in ['main', 'dev', 'aadarsh'] }
      }
      steps {
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    /* ---------- 3) Trivy Code Scan ---------- */
    stage('Trivy Code Scan') {
      steps {
        script {
          sh 'mkdir -p reports'
          def sev = (env.BRANCH_NAME == 'main') ? env.TRIVY_SEV_MAIN : env.TRIVY_SEV_DEV
          def trivyExists = sh(returnStatus:true,
                               script:'command -v trivy >/dev/null 2>&1') == 0
          def hasIgnoreFile = fileExists('.trivyignore')
          def ignoreFileFlag = hasIgnoreFile ? '--ignorefile .trivyignore' : ''
          def dockerIgnoreFileFlag = hasIgnoreFile ? '--ignorefile /workspace/.trivyignore' : ''
          int rc
          if (trivyExists) {
            rc = sh(returnStatus:true, script: """
              trivy fs --no-progress --skip-version-check \
                --severity ${sev} --exit-code 1 \
                --format json -o reports/trivy-fs.json \
                --skip-dirs ".git" \
                --skip-dirs "node_modules" \
                --skip-dirs "dist" \
                --skip-dirs "build" \
                --skip-dirs "reports" \
                --scanners vuln \
                ${ignoreFileFlag} \
                . \
                > reports/trivy-fs-console.txt 2>&1
            """)
          } else {
            rc = sh(returnStatus:true, script: """
              docker run --rm \
                -v ${WORKSPACE}:/workspace aquasec/trivy:latest fs --no-progress --skip-version-check \
                --severity ${sev} --exit-code 1 \
                --format json -o /workspace/reports/trivy-fs.json \
                --skip-dirs ".git" \
                --skip-dirs "node_modules" \
                --skip-dirs "dist" \
                --skip-dirs "build" \
                --skip-dirs "reports" \
                --scanners vuln \
                ${dockerIgnoreFileFlag} \
                /workspace \
                > ${WORKSPACE}/reports/trivy-fs-console.txt 2>&1
            """)
          }
          archiveArtifacts artifacts: 'reports/trivy-fs*', allowEmptyArchive: true
          if (rc != 0) {
            error "Trivy found ${sev} vulnerabilities in source code. Check reports/trivy-fs.json"
          }
        }
      }
    }

    /* ---------- 4) Docker Build ---------- */
    stage('Docker Build') {
      when { anyOf { branch 'main'; branch 'dev'; branch 'aadarsh' } }
      steps {
        script {
          // IMAGE is always ghcr.io/aadarsh0507/gg-cathlab — hardcoded to
          // prevent underscore/case drift when git repo name differs from GHCR slug.
          env.IMAGE = "ghcr.io/${env.GH_NAMESPACE}/${env.IMAGE_NAME}"

          def shortSha     = env.GIT_COMMIT.take(7)
          def buildNo      = env.BUILD_NUMBER
          def buildTime    = sh(returnStdout:true, script:'date -u +"%Y-%m-%dT%H:%M:%SZ"').trim()

          def latestTag = sh(returnStdout:true,
                             script:"git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0").trim()
          def parts     = latestTag.replace('v','').tokenize('.')
          def MAJOR     = (parts.size()>0 ? parts[0].replaceAll('[^0-9].*','') : '0') as int
          def MINOR     = (parts.size()>1 ? parts[1].replaceAll('[^0-9].*','') : '0') as int
          def PATCH     = (parts.size()>2 ? parts[2].replaceAll('[^0-9].*','') : '0') as int

          env.NEXT_VERSION = "v${MAJOR}.${MINOR}.${PATCH + 1}"
          env.RC_VERSION   = "${env.NEXT_VERSION}-rc.${buildNo}"

          def isMainBranch = (env.BRANCH_NAME == 'main')
          env.TAGS = isMainBranch
            ? "prod,latest,${env.NEXT_VERSION},${shortSha}"
            : "dev,${env.RC_VERSION},${shortSha}"

          env.PRIMARY_TAG  = env.TAGS.split(',')[0]
          env.SHORT_SHA    = shortSha
          env.BUILD_TIME   = buildTime

          def versionLabel = isMainBranch ? env.NEXT_VERSION : env.RC_VERSION

          echo "Building ${env.IMAGE}:${env.PRIMARY_TAG} (branch: ${env.BRANCH_NAME}, sha: ${shortSha})"

          sh '''
            set -eu
            echo "=== Docker pre-flight ==="
            test -f Dockerfile || { echo "ERROR: Dockerfile not found."; exit 1; }
            docker info >/dev/null 2>&1 || { echo "ERROR: cannot reach Docker daemon."; exit 1; }
            echo "Docker daemon OK."
          '''

          // --no-cache guarantees a fresh frontend build every time — without this,
          // Docker reuses cached npm install and build layers, so code changes in
          // frontend/src never reach the image even after a git pull.
          sh """
            docker build --no-cache -f Dockerfile \
              -t ${env.IMAGE}:${env.PRIMARY_TAG} \
              --build-arg VITE_API_BASE_URL="/api" \
              --build-arg GIT_COMMIT="${env.GIT_COMMIT}" \
              --build-arg APP_VERSION="${versionLabel}" \
              --build-arg BUILD_TIME="${buildTime}" \
              --label ci.branch=${env.BRANCH_NAME} \
              --label ci.sha=${env.GIT_COMMIT} \
              --label ci.build=${buildNo} \
              --label ci.version=${versionLabel} \
              .
          """

          // Tag the primary image with all additional tags
          for (t in env.TAGS.split(',')) {
            def tag = t.trim()
            if (tag && tag != env.PRIMARY_TAG) {
              sh "docker tag ${env.IMAGE}:${env.PRIMARY_TAG} ${env.IMAGE}:${tag}"
            }
          }

          // Verify labels are baked in
          sh """
            echo "=== Image labels ==="
            docker inspect --format='{{json .Config.Labels}}' ${env.IMAGE}:${env.PRIMARY_TAG}
          """
        }
      }
    }

    /* ---------- 5) Trivy Image Scan ---------- */
    stage('Trivy Scan') {
      when { anyOf { branch 'main'; branch 'dev'; branch 'aadarsh' } }
      steps {
        script {
          sh 'mkdir -p reports'
          def imageExists = sh(returnStatus:true,
                              script: "docker image inspect ${env.IMAGE}:${env.PRIMARY_TAG} >/dev/null 2>&1") == 0
          if (!imageExists) {
            echo "Image not found. Skipping Trivy image scan."
            return
          }
          def sev = (env.BRANCH_NAME == 'main') ? env.TRIVY_SEV_MAIN : env.TRIVY_SEV_DEV
          def trivyExists = sh(returnStatus:true,
                               script:'command -v trivy >/dev/null 2>&1') == 0
          def hasIgnoreFile = fileExists('.trivyignore')
          def ignoreFileFlag = hasIgnoreFile ? '--ignorefile .trivyignore' : ''
          def dockerIgnoreFileFlag = hasIgnoreFile ? '--ignorefile /workspace/.trivyignore' : ''

          try {
            if (trivyExists) {
              sh """
                trivy image --no-progress --skip-version-check \
                  --severity CRITICAL,HIGH --exit-code 0 \
                  --format table ${ignoreFileFlag} \
                  ${env.IMAGE}:${env.PRIMARY_TAG} \
                  > reports/trivy-image-summary.txt 2>&1 || true
                trivy image --no-progress --skip-version-check \
                  --severity ${sev} --exit-code 0 \
                  --format json -o reports/trivy-image.json ${ignoreFileFlag} \
                  ${env.IMAGE}:${env.PRIMARY_TAG} \
                  > reports/trivy-console.txt 2>&1 || true
              """
            } else {
              sh """
                docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
                  -v ${WORKSPACE}:/workspace aquasec/trivy:latest image --no-progress --skip-version-check \
                  --severity CRITICAL,HIGH --exit-code 0 --format table ${dockerIgnoreFileFlag} \
                  ${env.IMAGE}:${env.PRIMARY_TAG} \
                  > ${WORKSPACE}/reports/trivy-image-summary.txt 2>&1 || true
                docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
                  -v ${WORKSPACE}:/workspace aquasec/trivy:latest image --no-progress --skip-version-check \
                  --severity ${sev} --exit-code 0 \
                  --format json -o /workspace/reports/trivy-image.json ${dockerIgnoreFileFlag} \
                  ${env.IMAGE}:${env.PRIMARY_TAG} \
                  > ${WORKSPACE}/reports/trivy-console.txt 2>&1 || true
              """
            }
          } catch (Exception e) {
            error "Trivy scan execution failed: ${e.getMessage()}"
          }

          archiveArtifacts artifacts: 'reports/*', allowEmptyArchive: true

          if (fileExists('reports/trivy-image-summary.txt')) {
            sh 'cat reports/trivy-image-summary.txt || true'
          }

          def criticalCount = 0
          if (fileExists('reports/trivy-image.json')) {
            def criticalStr = sh(returnStdout: true, script: """
              grep -o '"Severity":"CRITICAL"' reports/trivy-image.json 2>/dev/null | wc -l || echo 0
            """).trim()
            criticalCount = criticalStr.isInteger() ? criticalStr.toInteger() : 0
          }

          if (criticalCount > 0) {
            error "Trivy found ${criticalCount} CRITICAL vulnerabilities. Check reports/trivy-image.json"
          } else {
            echo "Trivy Scan Passed: No CRITICAL vulnerabilities found."
          }
        }
      }
    }

    /* ---------- 6) Push to GHCR ---------- */
    stage('Push') {
      when { anyOf { branch 'main'; branch 'dev'; branch 'aadarsh' } }
      steps {
        script {
          def imageExists = sh(returnStatus:true,
                              script: "docker image inspect ${env.IMAGE}:${env.PRIMARY_TAG} >/dev/null 2>&1") == 0
          if (!imageExists) {
            error "Image ${env.IMAGE}:${env.PRIMARY_TAG} not found. Cannot push."
          }

          withCredentials([usernamePassword(
            credentialsId: env.GIT_CRED_ID,
            usernameVariable: 'GH_USER',
            passwordVariable: 'GH_PAT'
          )]) {
            sh 'echo "${GH_PAT}" | docker login ghcr.io -u "${GH_USER}" --password-stdin'

            def failedTags = []
            for (t in env.TAGS.split(',')) {
              def tag = t.trim()
              if (!tag) continue
              def ref = "${env.IMAGE}:${tag}"
              def tagExists = sh(returnStatus:true,
                                 script: "docker image inspect ${ref} >/dev/null 2>&1") == 0
              if (!tagExists) {
                failedTags.add("${ref} (not found locally)")
                continue
              }
              def pushRc = sh(returnStatus:true, script: "docker push ${ref} 2>&1 | tee reports/push-${tag}.log")
              if (pushRc == 0) {
                echo "SUCCESS: Pushed ${ref}"
              } else {
                sh "cat reports/push-${tag}.log || true"
                failedTags.add("${ref} (push failed)")
              }
            }

            if (failedTags.size() > 0) {
              error "Failed to push: ${failedTags.join(', ')}"
            }
            echo "SUCCESS: All tags pushed to ghcr.io/${env.GH_NAMESPACE}/${env.IMAGE_NAME}"

            // Show the digest of the pushed latest tag for verification
            sh """
              docker inspect --format='Digest: {{index .RepoDigests 0}}' \
                ${env.IMAGE}:${env.PRIMARY_TAG} 2>/dev/null || true
            """
          }

          // Create git release tag on main
          if (env.BRANCH_NAME == 'main') {
            withCredentials([usernamePassword(credentialsId: env.GIT_CRED_ID,
                                              usernameVariable: 'GH_USER',
                                              passwordVariable: 'GH_PAT')]) {
              try {
                def originUrl  = sh(returnStdout: true, script: "git config --get remote.origin.url").trim()
                def repoPath   = originUrl.replaceFirst(/^https?:\/\/[^\/]+\//, '').replaceFirst(/\.git$/, '')
                env.SOURCE_REPO_PATH = repoPath
                sh """
                  git config user.email "ci@jenkins"
                  git config user.name  "Jenkins CI"
                  if git tag -l | grep -q "^${env.NEXT_VERSION}\$"; then
                    git tag -d ${env.NEXT_VERSION}
                  fi
                  if git ls-remote --tags https://\${GH_USER}:\${GH_PAT}@github.com/${env.SOURCE_REPO_PATH}.git \
                       | grep -q "refs/tags/${env.NEXT_VERSION}\$"; then
                    echo "Tag ${env.NEXT_VERSION} already exists on remote, skipping"
                  else
                    git tag -a ${env.NEXT_VERSION} -m "Release ${env.NEXT_VERSION} from Jenkins"
                    git push https://\${GH_USER}:\${GH_PAT}@github.com/${env.SOURCE_REPO_PATH}.git ${env.NEXT_VERSION}
                  fi
                """
              } catch (Exception e) {
                echo "WARNING: Git tag failed: ${e.getMessage()} — continuing."
              }
            }
          }
        }
      }
    }

    /* ---------- 7) Cleanup Local Images ---------- */
    stage('Cleanup Local Images') {
      when { anyOf { branch 'main'; branch 'dev'; branch 'aadarsh' } }
      steps {
        script {
          for (t in env.TAGS.split(',')) {
            sh "docker rmi ${env.IMAGE}:${t.trim()} || true"
          }
          sh 'docker image prune -af || true'
          sh 'docker builder prune -af || true'
          sh 'docker system df || true'
        }
      }
    }

    stage('Skip notice') {
      when { not { anyOf { branch 'main'; branch 'dev'; branch 'aadarsh' } } }
      steps { echo "Only main, dev & aadarsh branches build. '${env.BRANCH_NAME}' skipped." }
    }
  }

  post {
    always {
      sh 'docker logout ghcr.io || true'
      sh 'docker image prune -f || true'
    }
  }
}
