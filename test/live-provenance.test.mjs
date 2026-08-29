// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import * as provenance from "../live-provenance.mjs";

const { verifyLiveBundleSnapshot, verifyWithRunner } = provenance;

const SNAPSHOT_PATH = resolve(
  "test",
  "bundle 'quoted' & whoami | echo %PATH% ; $(token).json",
);
const RELEASE_TAG =
  "live-evidence-v2-8ea331ff6670fe1f2221146f33f74cfd6c210b3d9c7eca48da2c592fe5d8764f";
const REPOSITORY = "ryanduguid/au-tax-legislation-corpus";
const WORKFLOW =
  "ryanduguid/au-tax-legislation-corpus/.github/workflows/publish-live-evidence.yml";
const EXEC_OPTIONS = {
  encoding: "utf8",
  maxBuffer: 65_536,
  shell: false,
  windowsHide: true,
};

const VERSION_OUTPUT =
  "gh version 2.98.0 (2026-08-27)\n" +
  "https://github.com/cli/cli/releases/tag/v2.98.0\n";
const HELP_OUTPUTS = [
  "Usage: gh release verify <tag>\n\n-R, --repo [HOST/]OWNER/REPO\n",
  "Usage: gh release verify-asset <tag> <path>\n\n-R, --repo [HOST/]OWNER/REPO\n",
  [
    "Usage: gh attestation verify <path>",
    "-R, --repo [HOST/]OWNER/REPO",
    "--signer-workflow OWNER/REPO/WORKFLOW",
    "--source-ref REF",
    "--predicate-type TYPE",
    "--deny-self-hosted-runners",
  ].join("\n"),
];

const ERROR_MESSAGES = {
  runner: "Live provenance runner is invalid.",
  path: "Live evidence snapshot path is invalid.",
  tag: "Live evidence release tag is invalid.",
  versionCommand: "GitHub CLI version check failed.",
  version: "GitHub CLI 2.98.0 or newer is required.",
  auth: "GitHub CLI authentication check failed.",
  releaseCapability: "GitHub CLI release verification capability is unavailable.",
  assetCapability: "GitHub CLI release asset verification capability is unavailable.",
  attestationCapability:
    "GitHub CLI attestation verification capability is unavailable.",
  release: "Live evidence release verification failed.",
  asset: "Live evidence asset verification failed.",
  attestation: "Live evidence attestation verification failed.",
};

function expectedArguments(snapshotPath = SNAPSHOT_PATH, releaseTag = RELEASE_TAG) {
  return [
    ["--version"],
    ["auth", "status"],
    ["release", "verify", "--help"],
    ["release", "verify-asset", "--help"],
    ["attestation", "verify", "--help"],
    ["release", "verify", releaseTag, "--repo", REPOSITORY],
    [
      "release",
      "verify-asset",
      releaseTag,
      snapshotPath,
      "--repo",
      REPOSITORY,
    ],
    [
      "attestation",
      "verify",
      snapshotPath,
      "--repo",
      REPOSITORY,
      "--signer-workflow",
      WORKFLOW,
      "--source-ref",
      "refs/heads/main",
      "--predicate-type",
      "https://slsa.dev/provenance/v1",
      "--deny-self-hosted-runners",
    ],
  ];
}

function fakeRunner({
  failAt = -1,
  helpOutputs = HELP_OUTPUTS,
  versionOutput = VERSION_OUTPUT,
} = {}) {
  const calls = [];
  const run = async (file, args, options) => {
    const index = calls.length;
    calls.push({ file, args: [...args], options: { ...options } });

    if (index === failAt) {
      const error = new Error(
        `sentinel-child-secret ${SNAPSHOT_PATH} ${RELEASE_TAG}`,
      );
      error.stdout = "sentinel-stdout-token";
      error.stderr = "sentinel-stderr-account";
      throw error;
    }

    if (index === 0) return { stdout: versionOutput, stderr: "" };
    if (index >= 2 && index <= 4) {
      return { stdout: helpOutputs[index - 2], stderr: "" };
    }
    if (index >= 5) {
      return {
        stdout: "sentinel-success-stdout",
        stderr: "sentinel-success-stderr",
      };
    }
    return { stdout: "sentinel-auth-account", stderr: "" };
  };
  return { calls, run };
}

async function assertFixedFailure(promise, expectedMessage) {
  await assert.rejects(promise, error => {
    assert.equal(error?.name, "LiveProvenanceError");
    assert.equal(error?.message, expectedMessage);
    assert.equal(Object.hasOwn(error, "cause"), false);
    const rendered = String(error);
    const serialised = JSON.stringify(error);
    for (const forbidden of [
      "sentinel",
      SNAPSHOT_PATH,
      RELEASE_TAG,
      "token",
      "account",
    ]) {
      assert.equal(rendered.includes(forbidden), false);
      assert.equal(serialised.includes(forbidden), false);
    }
    return true;
  });
}

test("runs the fixed no-shell provenance policy once in order", async () => {
  assert.deepEqual(Object.keys(provenance).sort(), [
    "verifyLiveBundleSnapshot",
    "verifyWithRunner",
  ]);
  assert.equal(verifyLiveBundleSnapshot.length, 1);
  assert.equal(verifyWithRunner.length, 1);
  const { calls, run } = fakeRunner();

  const result = await verifyWithRunner({
    snapshotPath: SNAPSHOT_PATH,
    releaseTag: RELEASE_TAG,
    run,
  });

  assert.equal(result, undefined);
  assert.equal(calls.length, 8);
  assert.deepEqual(calls.map(call => call.args), expectedArguments());
  for (const call of calls) {
    assert.equal(call.file, "gh");
    assert.deepEqual(call.options, EXEC_OPTIONS);
  }
  assert.equal(calls[6].args.filter(value => value === SNAPSHOT_PATH).length, 1);
  assert.equal(calls[7].args.filter(value => value === SNAPSHOT_PATH).length, 1);
});

test("rejects invalid inputs before invoking the runner", async () => {
  for (const input of [undefined, null, 7, "input", []]) {
    await assertFixedFailure(
      verifyWithRunner(input),
      ERROR_MESSAGES.runner,
    );
  }
  await assertFixedFailure(
    verifyWithRunner(
      new Proxy({}, {
        get() {
          throw new Error("sentinel-input-secret");
        },
      }),
    ),
    ERROR_MESSAGES.runner,
  );

  await assertFixedFailure(
    verifyWithRunner({
      snapshotPath: SNAPSHOT_PATH,
      releaseTag: RELEASE_TAG,
      run: null,
    }),
    ERROR_MESSAGES.runner,
  );

  for (const snapshotPath of [undefined, null, 7, "", "relative.json", "x\0y"]) {
    const { calls, run } = fakeRunner();
    await assertFixedFailure(
      verifyWithRunner({ snapshotPath, releaseTag: RELEASE_TAG, run }),
      ERROR_MESSAGES.path,
    );
    assert.equal(calls.length, 0);
  }

  for (const releaseTag of [
    undefined,
    null,
    7,
    "",
    `live-evidence-v2-${"a".repeat(63)}`,
    `live-evidence-v2-${"A".repeat(64)}`,
    `prefix-${RELEASE_TAG}`,
  ]) {
    const { calls, run } = fakeRunner();
    await assertFixedFailure(
      verifyWithRunner({ snapshotPath: SNAPSHOT_PATH, releaseTag, run }),
      ERROR_MESSAGES.tag,
    );
    assert.equal(calls.length, 0);
  }
});

test("accepts the minimum and newer stable GitHub CLI versions", async () => {
  for (const version of ["2.98.0", "2.98.1", "2.99.0", "3.0.0"]) {
    const { calls, run } = fakeRunner({
      versionOutput:
        `gh version ${version} (2026-08-27)\r\n` +
        `https://github.com/cli/cli/releases/tag/v${version}\r\n`,
    });
    await verifyWithRunner({
      snapshotPath: SNAPSHOT_PATH,
      releaseTag: RELEASE_TAG,
      run,
    });
    assert.equal(calls.length, 8);
  }
});

test("rejects unavailable, old and non-official version output", async () => {
  const failed = fakeRunner({ failAt: 0 });
  await assertFixedFailure(
    verifyWithRunner({
      snapshotPath: SNAPSHOT_PATH,
      releaseTag: RELEASE_TAG,
      run: failed.run,
    }),
    ERROR_MESSAGES.versionCommand,
  );
  assert.equal(failed.calls.length, 1);

  for (const versionOutput of [
    "gh version 2.97.99 (2026-08-27)\n",
    "gh version 1.999.999 (2026-08-27)\n",
    "gh version 2.98.0-rc.1 (2026-08-27)\n",
    "gh version 02.98.0 (2026-08-27)\n",
    "gh version 2.098.0 (2026-08-27)\n",
    "gh version 2.98.00 (2026-08-27)\n",
    "gh version 2.98.0.1 (2026-08-27)\n",
    "\u001b[32mgh version 2.98.0 (2026-08-27)\u001b[0m\n",
    "prefix gh version 2.98.0 (2026-08-27)\n",
    "\ngh version 2.98.0 (2026-08-27)\n",
    "not a version\ngh version 2.98.0 (2026-08-27)\n",
    "gh version 2.98.0 (2026-08-27) trailing\n",
    "gh version 2.98.0.evil (2026-08-27)\n",
    { toString: () => VERSION_OUTPUT },
  ]) {
    const { calls, run } = fakeRunner({ versionOutput });
    await assertFixedFailure(
      verifyWithRunner({
        snapshotPath: SNAPSHOT_PATH,
        releaseTag: RELEASE_TAG,
        run,
      }),
      ERROR_MESSAGES.version,
    );
    assert.equal(calls.length, 1);
  }
});

test("stops on authentication failure without leaking child output", async () => {
  const { calls, run } = fakeRunner({ failAt: 1 });

  await assertFixedFailure(
    verifyWithRunner({
      snapshotPath: SNAPSHOT_PATH,
      releaseTag: RELEASE_TAG,
      run,
    }),
    ERROR_MESSAGES.auth,
  );

  assert.equal(calls.length, 2);
});

const capabilityCases = [
  {
    name: "release verification",
    callIndex: 2,
    helpIndex: 0,
    required: ["--repo"],
    lookalikes: {
      "--repo": [
        "--repository",
        "--repo-name",
        "prefix--repo",
        "--repo=value",
        "--Repo",
      ],
    },
    message: ERROR_MESSAGES.releaseCapability,
  },
  {
    name: "release asset verification",
    callIndex: 3,
    helpIndex: 1,
    required: ["--repo"],
    lookalikes: {
      "--repo": [
        "--repository",
        "--repo-name",
        "prefix--repo",
        "--repo=value",
        "--Repo",
      ],
    },
    message: ERROR_MESSAGES.assetCapability,
  },
  {
    name: "attestation verification",
    callIndex: 4,
    helpIndex: 2,
    required: [
      "--repo",
      "--signer-workflow",
      "--source-ref",
      "--predicate-type",
      "--deny-self-hosted-runners",
    ],
    lookalikes: {
      "--repo": [
        "--repository",
        "--repo-name",
        "prefix--repo",
        "--repo=value",
        "--Repo",
      ],
      "--signer-workflow": ["--signer-workflows", "--signer-workflow=value"],
      "--source-ref": ["--source-reference", "--source-ref=value"],
      "--predicate-type": ["--predicate-types", "--predicate-type=value"],
      "--deny-self-hosted-runners": [
        "--deny-self-hosted-runners-extra",
        "--deny-self-hosted-runners=value",
      ],
    },
    message: ERROR_MESSAGES.attestationCapability,
  },
];

for (const capability of capabilityCases) {
  test(`${capability.name} help failure stops at its capability check`, async () => {
    const { calls, run } = fakeRunner({ failAt: capability.callIndex });
    await assertFixedFailure(
      verifyWithRunner({
        snapshotPath: SNAPSHOT_PATH,
        releaseTag: RELEASE_TAG,
        run,
      }),
      capability.message,
    );
    assert.equal(calls.length, capability.callIndex + 1);
  });

  for (const missing of capability.required) {
    for (const lookalike of capability.lookalikes[missing]) {
      test(`${capability.name} rejects ${lookalike} in place of ${missing}`, async () => {
        const helpOutputs = [...HELP_OUTPUTS];
        helpOutputs[capability.helpIndex] = capability.required
          .map(token => (token === missing ? lookalike : token))
          .join("\n");
        const { calls, run } = fakeRunner({ helpOutputs });

        await assertFixedFailure(
          verifyWithRunner({
            snapshotPath: SNAPSHOT_PATH,
            releaseTag: RELEASE_TAG,
            run,
          }),
          capability.message,
        );
        assert.equal(calls.length, capability.callIndex + 1);
      });
    }
  }
}

const provenanceFailures = [
  [5, ERROR_MESSAGES.release],
  [6, ERROR_MESSAGES.asset],
  [7, ERROR_MESSAGES.attestation],
];

for (const [failAt, message] of provenanceFailures) {
  test(`provenance command ${failAt - 4} fails closed without retry`, async () => {
    const { calls, run } = fakeRunner({ failAt });

    await assertFixedFailure(
      verifyWithRunner({
        snapshotPath: SNAPSHOT_PATH,
        releaseTag: RELEASE_TAG,
        run,
      }),
      message,
    );

    assert.equal(calls.length, failAt + 1);
    assert.deepEqual(
      calls.map(call => call.args),
      expectedArguments().slice(0, failAt + 1),
    );
  });
}

test("an absolute hostile path remains one argument in both file checks", async () => {
  const hostilePath = join(
    resolve("test"),
    "bundle --repo attacker; $env:TOKEN | & gh.exe `whoami`.json",
  );
  const { calls, run } = fakeRunner();

  await verifyWithRunner({
    snapshotPath: hostilePath,
    releaseTag: RELEASE_TAG,
    run,
  });

  assert.deepEqual(
    calls.map(call => call.args),
    expectedArguments(hostilePath),
  );
  assert.equal(calls[6].args[3], hostilePath);
  assert.equal(calls[7].args[2], hostilePath);
});
