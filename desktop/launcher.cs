using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ClearPlayerLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string executable = Path.Combine(root, "desktop-app", "澄音播放器.exe");
            if (!File.Exists(executable))
                throw new FileNotFoundException("请将启动文件与 desktop-app 文件夹放在一起，再重新打开播放器。");
            ProcessStartInfo start = new ProcessStartInfo(executable);
            start.WorkingDirectory = Path.GetDirectoryName(executable);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(start);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "澄音暂时无法启动", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}
