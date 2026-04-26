from __future__ import annotations

import asyncio
import textwrap
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from app.models import GradeResult, GradeStatus


_TIMEOUT_SECONDS = 8


@dataclass
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


async def grade_code_review_submission(
    challenge_id: str, language: str, code: str
) -> GradeResult:
    grader = _GRADERS.get((challenge_id, language))
    if grader is None:
        return GradeResult(
            status=GradeStatus.ERROR,
            message="No backend validator is available for this code review challenge yet.",
        )
    try:
        return await grader(code)
    except Exception as exc:
        return GradeResult(
            status=GradeStatus.ERROR,
            message=f"Code review grader error: {exc}",
        )


async def _grade_division_factory_javascript(code: str) -> GradeResult:
    with TemporaryDirectory(prefix="lector-code-review-js-") as tmp:
        tmpdir = Path(tmp)
        submission = tmpdir / "submission.js"
        submission.write_text(code, encoding="utf-8")

        syntax = await _run_command(["node", "--check", str(submission)], cwd=tmpdir)
        if syntax.exit_code != 0:
            return _compile_error("JavaScript", syntax)

        function_src = _extract_javascript_function(code, "createDivider")
        if not function_src:
            return GradeResult(
                status=GradeStatus.FAILED,
                message="Test failed: Could not locate `createDivider` for backend execution.",
            )

        harness = tmpdir / "harness.js"
        harness.write_text(
            textwrap.dedent(
                f"""
                "use strict";
                {function_src}

                function fail(message) {{
                  console.error(`TEST FAIL: ${{message}}`);
                  process.exit(1);
                }}

                function expectThrows(description, fn) {{
                  try {{
                    fn();
                    fail(description);
                  }} catch (_err) {{
                    return;
                  }}
                }}

                const half = createDivider(2);
                if (half(10) !== 5) {{
                  fail("Valid numeric division should still produce the expected quotient.");
                }}

                expectThrows(
                  "Construction should reject zero divisors explicitly.",
                  () => createDivider(0),
                );
                expectThrows(
                  'Construction should reject non-number divisors like "2".',
                  () => createDivider("2"),
                );
                expectThrows(
                  "Calls should reject null instead of coercing it into 0.",
                  () => half(null),
                );
                expectThrows(
                  "Calls should reject array inputs like [] before division happens.",
                  () => half([]),
                );
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )

        run = await _run_command(["node", str(harness)], cwd=tmpdir)
        if run.exit_code != 0:
            return _test_failure(run)

        return GradeResult(
            status=GradeStatus.PASSED,
            message="Backend verification passed: the code compiles and the divider behaves correctly on valid and invalid inputs.",
            track_test_passed=True,
        )


async def _grade_division_factory_python(code: str) -> GradeResult:
    with TemporaryDirectory(prefix="lector-code-review-py-") as tmp:
        tmpdir = Path(tmp)
        submission = tmpdir / "submission.py"
        submission.write_text(code, encoding="utf-8")

        syntax = await _run_command(
            ["python3", "-m", "py_compile", str(submission)], cwd=tmpdir
        )
        if syntax.exit_code != 0:
            return _compile_error("Python", syntax)

        harness = tmpdir / "harness.py"
        harness.write_text(
            textwrap.dedent(
                """
                from submission import create_divider

                def fail(message):
                    raise AssertionError(f"TEST FAIL: {message}")

                divider = create_divider(2)
                if divider(10) != 5:
                    fail("Valid numeric division should still produce the expected quotient.")

                for bad_divisor in (0, False, None):
                    try:
                        create_divider(bad_divisor)
                        fail(f"Construction should reject invalid divisor {bad_divisor!r}.")
                    except (TypeError, ValueError, ArithmeticError):
                        pass

                for bad_value in ("ten", None, object(), False):
                    try:
                        divider(bad_value)
                        fail(f"Calls should reject invalid value {bad_value!r}.")
                    except (TypeError, ValueError, ArithmeticError):
                        pass
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )

        run = await _run_command(["python3", str(harness)], cwd=tmpdir)
        if run.exit_code != 0:
            return _test_failure(run)

        return GradeResult(
            status=GradeStatus.PASSED,
            message="Backend verification passed: the code compiles and the divider handles valid and invalid Python inputs correctly.",
            track_test_passed=True,
        )


async def _grade_division_factory_java(code: str) -> GradeResult:
    with TemporaryDirectory(prefix="lector-code-review-java-") as tmp:
        tmpdir = Path(tmp)
        submission = tmpdir / "DividerFactory.java"
        submission.write_text(code, encoding="utf-8")

        compile_result = await _run_command(["javac", str(submission)], cwd=tmpdir)
        if compile_result.exit_code != 0:
            return _compile_error("Java", compile_result)

        harness = tmpdir / "DividerFactoryHarness.java"
        harness.write_text(
            textwrap.dedent(
                """
                import java.util.function.DoubleUnaryOperator;

                public class DividerFactoryHarness {
                    private static void fail(String message) {
                        System.err.println("TEST FAIL: " + message);
                        System.exit(1);
                    }

                    private static void expectThrows(String description, Runnable fn) {
                        try {
                            fn.run();
                            fail(description);
                        } catch (RuntimeException expected) {
                            return;
                        }
                    }

                    public static void main(String[] args) {
                        DoubleUnaryOperator half = DividerFactory.createDivider(2.0);
                        double result = half.applyAsDouble(10.0);
                        if (Math.abs(result - 5.0) > 1e-9) {
                            fail("Valid numeric division should still produce the expected quotient.");
                        }

                        expectThrows(
                            "Construction should reject zero divisors explicitly.",
                            () -> DividerFactory.createDivider(0.0)
                        );
                        expectThrows(
                            "Construction should reject NaN divisors explicitly.",
                            () -> DividerFactory.createDivider(Double.NaN)
                        );
                        expectThrows(
                            "Construction should reject infinite divisors explicitly.",
                            () -> DividerFactory.createDivider(Double.POSITIVE_INFINITY)
                        );
                        expectThrows(
                            "Calls should reject non-finite values like NaN before division happens.",
                            () -> half.applyAsDouble(Double.NaN)
                        );
                        expectThrows(
                            "Calls should reject non-finite values like infinity before division happens.",
                            () -> half.applyAsDouble(Double.NEGATIVE_INFINITY)
                        );
                    }
                }
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )

        harness_compile = await _run_command(["javac", str(harness)], cwd=tmpdir)
        if harness_compile.exit_code != 0:
            return _compile_error("Java harness", harness_compile)

        run = await _run_command(["java", "-cp", str(tmpdir), "DividerFactoryHarness"], cwd=tmpdir)
        if run.exit_code != 0:
            return _test_failure(run)

        return GradeResult(
            status=GradeStatus.PASSED,
            message="Backend verification passed: the code compiles and the divider enforces finite numeric inputs in Java.",
            track_test_passed=True,
        )


async def _grade_pointing_python(code: str) -> GradeResult:
    with TemporaryDirectory(prefix="lector-code-review-py-") as tmp:
        tmpdir = Path(tmp)
        submission = tmpdir / "submission.py"
        submission.write_text(code, encoding="utf-8")

        syntax = await _run_command(
            ["python3", "-m", "py_compile", str(submission)], cwd=tmpdir
        )
        if syntax.exit_code != 0:
            return _compile_error("Python", syntax)

        harness = tmpdir / "harness.py"
        harness.write_text(
            textwrap.dedent(
                """
                from submission import make_greeting

                def fail(message):
                    raise AssertionError(f"TEST FAIL: {message}")

                def normalize(value):
                    if isinstance(value, bytearray):
                        return bytes(value).decode()
                    if isinstance(value, bytes):
                        return value.decode()
                    return str(value)

                first = make_greeting("world")
                second = make_greeting("everyone")

                if normalize(first) == normalize(second):
                    fail("Two different calls should not collapse into the same greeting.")

                if normalize(first) != "Hello, world!" or normalize(second) != "Hello, everyone!":
                    fail("Each call should produce its own greeting with the right name.")

                third = make_greeting("teammate")
                if normalize(first) != "Hello, world!":
                    fail("Earlier greetings should remain stable after later calls.")

                if normalize(third) != "Hello, teammate!":
                    fail("Later calls should still produce the expected greeting.")
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )

        run = await _run_command(["python3", str(harness)], cwd=tmpdir)
        if run.exit_code != 0:
            return _test_failure(run)

        return GradeResult(
            status=GradeStatus.PASSED,
            message="Backend verification passed: each Python call returns an independent greeting and no later mutation corrupts earlier results.",
            track_test_passed=True,
        )


async def _grade_pointing_java(code: str) -> GradeResult:
    with TemporaryDirectory(prefix="lector-code-review-java-") as tmp:
        tmpdir = Path(tmp)
        submission = tmpdir / "GreetingFactory.java"
        submission.write_text(code, encoding="utf-8")

        compile_result = await _run_command(["javac", str(submission)], cwd=tmpdir)
        if compile_result.exit_code != 0:
            return _compile_error("Java", compile_result)

        harness = tmpdir / "GreetingFactoryHarness.java"
        harness.write_text(
            textwrap.dedent(
                """
                public class GreetingFactoryHarness {
                    private static void fail(String message) {
                        System.err.println("TEST FAIL: " + message);
                        System.exit(1);
                    }

                    public static void main(String[] args) {
                        GreetingFactory factory = new GreetingFactory();
                        Object first = factory.makeGreeting("world");
                        Object second = factory.makeGreeting("everyone");

                        if (!"Hello, world!".equals(String.valueOf(first))) {
                            fail("The first greeting should stay \"Hello, world!\" even after a later call.");
                        }
                        if (!"Hello, everyone!".equals(String.valueOf(second))) {
                            fail("The second greeting should contain the second name.");
                        }

                        Object third = factory.makeGreeting("teammate");
                        if (!"Hello, world!".equals(String.valueOf(first))) {
                            fail("Earlier results should remain independent after more calls.");
                        }
                        if (!"Hello, teammate!".equals(String.valueOf(third))) {
                            fail("Later calls should still produce the expected greeting.");
                        }
                    }
                }
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )

        harness_compile = await _run_command(["javac", str(harness)], cwd=tmpdir)
        if harness_compile.exit_code != 0:
            return _compile_error("Java harness", harness_compile)

        run = await _run_command(["java", "-cp", str(tmpdir), "GreetingFactoryHarness"], cwd=tmpdir)
        if run.exit_code != 0:
            return _test_failure(run)

        return GradeResult(
            status=GradeStatus.PASSED,
            message="Backend verification passed: each Java call produces an independent greeting and shared mutable state no longer leaks out.",
            track_test_passed=True,
        )


async def _grade_pointing_c(code: str) -> GradeResult:
    with TemporaryDirectory(prefix="lector-code-review-c-") as tmp:
        tmpdir = Path(tmp)
        submission = tmpdir / "submission.c"
        submission.write_text(code, encoding="utf-8")

        compile_result = await _run_command(
            [
                "gcc",
                "-std=c11",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-Dmain=challenge_user_main",
                "-c",
                str(submission),
                "-o",
                str(tmpdir / "submission.o"),
            ],
            cwd=tmpdir,
        )
        if compile_result.exit_code != 0:
            return _compile_error("C", compile_result)

        uses_buffer_signature = "make_greeting(const char *name, char *" in code
        if uses_buffer_signature:
            harness_src = textwrap.dedent(
                """
                #include <stdio.h>
                #include <stdlib.h>
                #include <string.h>

                char *make_greeting(const char *name, char *buffer, size_t size);

                static void fail(const char *message) {
                    fprintf(stderr, "TEST FAIL: %s\\n", message);
                    exit(1);
                }

                int main(void) {
                    char first[128];
                    char second[128];
                    char long_buffer[256];
                    const char *long_name = "abcdefghijklmnopqrstuvwxyz0123456789";
                    char expected[256];

                    char *first_result = make_greeting("world", first, sizeof(first));
                    char *second_result = make_greeting("everyone", second, sizeof(second));
                    char *long_result = make_greeting(long_name, long_buffer, sizeof(long_buffer));

                    if (!first_result || strcmp(first_result, "Hello, world!") != 0) {
                        fail("The first greeting should contain the first name.");
                    }
                    if (!second_result || strcmp(second_result, "Hello, everyone!") != 0) {
                        fail("The second greeting should contain the second name.");
                    }
                    snprintf(expected, sizeof(expected), "Hello, %s!", long_name);
                    if (!long_result || strcmp(long_result, expected) != 0) {
                        fail("Long names should be handled safely without truncation or overflow.");
                    }
                    return 0;
                }
                """
            ).strip()
        else:
            harness_src = textwrap.dedent(
                """
                #include <stdio.h>
                #include <stdlib.h>
                #include <string.h>

                char *make_greeting(const char *name);

                static void fail(const char *message) {
                    fprintf(stderr, "TEST FAIL: %s\\n", message);
                    exit(1);
                }

                int main(void) {
                    const char *long_name = "abcdefghijklmnopqrstuvwxyz0123456789";
                    char expected[256];
                    char *first = make_greeting("world");
                    char *second = make_greeting("everyone");
                    char *long_result = make_greeting(long_name);

                    if (!first || strcmp(first, "Hello, world!") != 0) {
                        fail("The first greeting should contain the first name and remain stable.");
                    }
                    if (!second || strcmp(second, "Hello, everyone!") != 0) {
                        fail("The second greeting should contain the second name.");
                    }

                    snprintf(expected, sizeof(expected), "Hello, %s!", long_name);
                    if (!long_result || strcmp(long_result, expected) != 0) {
                        fail("Long names should be handled safely without truncation or overflow.");
                    }
                    return 0;
                }
                """
            ).strip()

        harness = tmpdir / "harness.c"
        harness.write_text(harness_src + "\n", encoding="utf-8")

        link_result = await _run_command(
            [
                "gcc",
                "-std=c11",
                "-Wall",
                "-Wextra",
                "-Werror",
                str(harness),
                str(tmpdir / "submission.o"),
                "-o",
                str(tmpdir / "harness"),
            ],
            cwd=tmpdir,
        )
        if link_result.exit_code != 0:
            return _compile_error("C harness", link_result)

        run = await _run_command([str(tmpdir / "harness")], cwd=tmpdir)
        if run.exit_code != 0:
            return _test_failure(run)

        return GradeResult(
            status=GradeStatus.PASSED,
            message="Backend verification passed: the C implementation compiles cleanly and returns safe, correct greetings across repeated calls.",
            track_test_passed=True,
        )


async def _run_command(
    cmd: list[str], cwd: Path, timeout: int = _TIMEOUT_SECONDS
) -> CommandResult:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return CommandResult(
            exit_code=127,
            stdout="",
            stderr=f"Required runtime not found: {cmd[0]}",
        )

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return CommandResult(
            exit_code=-1,
            stdout="",
            stderr=f"Command timed out after {timeout} seconds",
            timed_out=True,
        )

    return CommandResult(
        exit_code=proc.returncode,
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
    )


def _compile_error(language: str, result: CommandResult) -> GradeResult:
    detail = _compact_output(result.stderr or result.stdout)
    return GradeResult(
        status=GradeStatus.ERROR,
        message=f"{language} compilation error:\n{detail}",
        output=detail,
    )


def _test_failure(result: CommandResult) -> GradeResult:
    detail = _compact_output(result.stderr or result.stdout)
    if detail.startswith("TEST FAIL:"):
        message = detail
    else:
        message = f"Runtime validation failed:\n{detail}"
    return GradeResult(
        status=GradeStatus.FAILED,
        message=message,
        track_test_passed=False,
        output=detail,
    )


def _compact_output(text: str, max_lines: int = 12) -> str:
    cleaned = [line.rstrip() for line in text.strip().splitlines() if line.strip()]
    if not cleaned:
        return "No additional output was produced."
    if len(cleaned) > max_lines:
        cleaned = cleaned[:max_lines]
    return "\n".join(cleaned)


def _extract_javascript_function(source: str, name: str) -> str | None:
    marker = f"function {name}("
    start = source.find(marker)
    if start == -1:
        return None
    brace_start = source.find("{", start)
    if brace_start == -1:
        return None

    depth = 0
    in_single = False
    in_double = False
    in_template = False
    escaped = False

    for idx in range(brace_start, len(source)):
        char = source[idx]
        if escaped:
            escaped = False
            continue
        if char == "\\" and (in_single or in_double or in_template):
            escaped = True
            continue
        if char == "'" and not in_double and not in_template:
            in_single = not in_single
            continue
        if char == '"' and not in_single and not in_template:
            in_double = not in_double
            continue
        if char == "`" and not in_single and not in_double:
            in_template = not in_template
            continue
        if in_single or in_double or in_template:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start : idx + 1]
    return None


_GRADERS = {
    ("code-review-division-factory", "javascript"): _grade_division_factory_javascript,
    ("code-review-division-factory", "python"): _grade_division_factory_python,
    ("code-review-division-factory", "java"): _grade_division_factory_java,
    ("code-review-what-are-you-pointing-at", "python"): _grade_pointing_python,
    ("code-review-what-are-you-pointing-at", "java"): _grade_pointing_java,
    ("code-review-what-are-you-pointing-at", "c"): _grade_pointing_c,
}
