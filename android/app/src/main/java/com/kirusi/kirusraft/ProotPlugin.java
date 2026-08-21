package com.kirusi.kirusraft;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.concurrent.TimeUnit;

/**
 * proot 沙箱 Capacitor 插件（v0.0.81 Java 版）
 * 桥接 WebView TS 层 → Android 原生 proot 执行
 * 需要 libproot_exec.so / libproot_loader.so 放在 getFilesDir()/lib/
 */
@CapacitorPlugin(name = "ProotPlugin")
public class ProotPlugin extends Plugin {

    @PluginMethod
    public void createWorkspace(PluginCall call) {
        String name = call.getString("name", "default");
        File wsDir = workspaceDir(name);
        wsDir.mkdirs();
        new File(wsDir, "files").mkdirs();
        new File(wsDir, "linux").mkdirs();
        new File(wsDir, "tmp").mkdirs();
        JSObject ret = new JSObject();
        ret.put("id", name);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteWorkspace(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("id required"); return; }
        deleteDir(workspaceDir(id));
        call.resolve();
    }

    @PluginMethod
    public void executeCommand(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        String command = call.getString("command");
        String cwd = call.getString("cwd", "/workspace");
        int timeout = call.getInt("timeout", 30);
        if (workspaceId == null || command == null) { call.reject("workspaceId and command required"); return; }
        try {
            CommandResult result = exec(workspaceId, command, cwd, timeout);
            JSObject ret = new JSObject();
            ret.put("stdout", result.stdout);
            ret.put("stderr", result.stderr);
            ret.put("exitCode", result.exitCode);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "命令执行失败", e);
        }
    }

    @PluginMethod
    public void patchRootfs(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        if (workspaceId == null) { call.reject("workspaceId required"); return; }
        patch(workspaceDir(workspaceId));
        call.resolve();
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        String path = call.getString("path");
        if (workspaceId == null || path == null) { call.reject("workspaceId and path required"); return; }
        File file = resolvePath(workspaceId, path);
        if (file == null || !file.exists() || !file.isFile()) { call.reject("文件不存在"); return; }
        try {
            java.util.Scanner scanner = new java.util.Scanner(file, "UTF-8").useDelimiter("\\A");
            String content = scanner.hasNext() ? scanner.next() : "";
            scanner.close();
            JSObject ret = new JSObject();
            ret.put("content", content);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        String path = call.getString("path");
        String content = call.getString("content");
        if (workspaceId == null || path == null || content == null) { call.reject("参数不完整"); return; }
        File file = resolvePath(workspaceId, path);
        if (file == null) { call.reject("路径非法"); return; }
        try {
            file.getParentFile().mkdirs();
            java.io.FileWriter fw = new java.io.FileWriter(file, java.nio.charset.StandardCharsets.UTF_8);
            fw.write(content);
            fw.close();
            call.resolve();
        } catch (Exception e) {
            call.reject("写入失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String workspaceId = call.getString("workspaceId");
        String path = call.getString("path", "/workspace");
        if (workspaceId == null) { call.reject("workspaceId required"); return; }
        File dir = resolvePath(workspaceId, path);
        if (dir == null || !dir.isDirectory()) { call.reject("不是目录"); return; }
        JSArray entries = new JSArray();
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                JSObject entry = new JSObject();
                entry.put("name", f.getName());
                entry.put("type", f.isDirectory() ? "dir" : "file");
                entry.put("size", f.length());
                entries.put(entry);
            }
        }
        JSObject ret = new JSObject();
        ret.put("entries", entries);
        call.resolve(ret);
    }

    // ===== 命令执行（proot） =====
    static class CommandResult { String stdout, stderr; int exitCode; }
    private CommandResult exec(String workspaceId, String command, String cwd, int timeout) throws Exception {
        File wsDir = workspaceDir(workspaceId);
        File filesDir = new File(wsDir, "files");
        File linuxDir = new File(wsDir, "linux");
        File tmpDir = new File(wsDir, "tmp");

        if (!new File(linuxDir, "bin/sh").exists()) throw new RuntimeException("Rootfs is not installed");
        if (!filesDir.isDirectory()) throw new RuntimeException("Workspace files dir not found");

        patch(wsDir); // 每次执行前修补 rootfs

        String prootCwd = cwd.isEmpty() ? "/workspace" : "/workspace/" + cwd.replaceAll("^/+", "");
        String nativeLibDir = new File(getContext().getFilesDir(), "lib").getAbsolutePath();

        ProcessBuilder pb = new ProcessBuilder(
            nativeLibDir + "/libproot_exec.so",
            "--root-id", "--link2symlink", "--kill-on-exit",
            "-r", linuxDir.getAbsolutePath(),
            "-w", prootCwd,
            "-b", filesDir.getAbsolutePath() + ":/workspace",
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
            "--",
            "/usr/bin/env", "-i",
            "HOME=/root", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "TERM=xterm-256color", "LANG=C.UTF-8", "LC_ALL=C.UTF-8",
            "/bin/bash", "-l", "-c", "cd -- \"$1\" && eval \"$2\"",
            "kirusraft", prootCwd, command
        );
        pb.directory(filesDir).redirectErrorStream(false);
        pb.environment().put("PROOT_LOADER", nativeLibDir + "/libproot_loader.so");
        pb.environment().put("PROOT_TMP_DIR", tmpDir.getAbsolutePath());
        pb.environment().put("TMPDIR", tmpDir.getAbsolutePath());
        tmpDir.mkdirs();

        Process process = pb.start();
        BufferedReader stdOut = new BufferedReader(new InputStreamReader(process.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
        BufferedReader stdErr = new BufferedReader(new InputStreamReader(process.getErrorStream(), java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder outSb = new StringBuilder(), errSb = new StringBuilder();
        String line;
        while ((line = stdOut.readLine()) != null) outSb.append(line).append("\n");
        while ((line = stdErr.readLine()) != null) errSb.append(line).append("\n");

        boolean finished = process.waitFor(timeout, TimeUnit.SECONDS);
        CommandResult r = new CommandResult();
        if (!finished) {
            process.destroyForcibly();
            r.stdout = outSb.toString();
            r.stderr = errSb.toString() + "\n[超时 " + timeout + "s 进程已杀死]";
            r.exitCode = -1;
            return r;
        }
        r.stdout = outSb.toString();
        r.stderr = errSb.toString();
        r.exitCode = process.exitValue();
        return r;
    }

    // ===== RootfsPatcher（每次命令前修补 DNS/权限） =====
    private void patch(File wsDir) {
        File linuxDir = new File(wsDir, "linux");
        if (!linuxDir.exists()) return;
        writeFile(new File(linuxDir, "etc/resolv.conf"), "nameserver 8.8.8.8\nnameserver 1.1.1.1\n");
        if (!new File(linuxDir, "etc/hosts").exists())
            writeFile(new File(linuxDir, "etc/hosts"), "127.0.0.1 localhost\n::1 localhost\n");
        writeFile(new File(linuxDir, "etc/hostname"), "kirusraft-sandbox\n");
        File tmpDir = new File(linuxDir, "tmp");
        tmpDir.mkdirs();
        tmpDir.setWritable(true, false); tmpDir.setReadable(true, false); tmpDir.setExecutable(true, false);
        File varTmp = new File(linuxDir, "var/tmp");
        varTmp.mkdirs();
        varTmp.setWritable(true, false);
    }
    private void writeFile(File f, String content) { try { f.getParentFile().mkdirs(); java.io.FileWriter fw = new java.io.FileWriter(f); fw.write(content); fw.close(); } catch (Exception ignored) {} }

    // ===== 辅助 =====
    private File workspaceBase() { return new File(getContext().getFilesDir(), "workspaces"); }
    private File workspaceDir(String id) { return new File(workspaceBase(), id.replaceAll("[^A-Za-z0-9._-]", "_")); }
    private File resolvePath(String workspaceId, String userPath) {
        File filesDir = new File(workspaceDir(workspaceId), "files");
        String clean = userPath.replaceAll("^/workspace/?", "").replaceAll("^/", "").trim();
        if (clean.contains("..")) return null;
        try {
            File resolved = new File(filesDir, clean).getCanonicalFile();
            return resolved.getCanonicalPath().startsWith(filesDir.getCanonicalPath()) ? resolved : null;
        } catch (Exception e) { return null; }
    }
    private void deleteDir(File dir) { File[] files = dir.listFiles(); if (files != null) for (File f : files) deleteDir(f); dir.delete(); }
}