package io.github.nexgenfullstack.madeirabus;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Hands the documents the app makes (printable timetables) to the person:
 * "save as" through the system file picker, the Android print dialog (which
 * can also save a PDF) and the share sheet. None of them needs a storage
 * permission, and a web view can do none of them by itself.
 */
@CapacitorPlugin(name = "Documents")
public class DocumentsPlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        if (decode(call) == null) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/pdf"));
        intent.putExtra(Intent.EXTRA_TITLE, fileName(call));
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data != null ? data.getData() : null;
        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }
        byte[] bytes = decode(call);
        if (bytes == null) return;
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new IOException("No stream for " + uri);
            out.write(bytes);
            ret.put("saved", true);
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Could not save the file", e);
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        byte[] bytes = decode(call);
        if (bytes == null) return;
        String name = fileName(call);
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            PrintManager printer = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
            if (printer == null) {
                call.reject("Printing is not available");
                return;
            }
            printer.print(name, new PdfAdapter(name, bytes), new PrintAttributes.Builder().build());
            call.resolve();
        });
    }

    @PluginMethod
    public void share(PluginCall call) {
        byte[] bytes = decode(call);
        if (bytes == null) return;
        String name = fileName(call);
        try {
            File dir = new File(getContext().getCacheDir(), "documents");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No cache folder");
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
            String title = call.getString("title", name);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mimeType", "application/pdf"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, title));
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Could not share the file", e);
        }
    }

    /** The file's bytes, or null after rejecting the call. */
    private byte[] decode(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return null;
        }
        try {
            return Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Data is not base64", e);
            return null;
        }
    }

    /** A plain file name: no folders, nothing a file system could trip over. */
    private static String fileName(PluginCall call) {
        String name = call.getString("fileName", "MadeiraBus.pdf");
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return name.isEmpty() ? "MadeiraBus.pdf" : name;
    }

    /** Feeds a finished PDF to the print framework as it is. */
    private static final class PdfAdapter extends PrintDocumentAdapter {
        private final String name;
        private final byte[] bytes;

        PdfAdapter(String name, byte[] bytes) {
            this.name = name;
            this.bytes = bytes;
        }

        @Override
        public void onLayout(
            PrintAttributes oldAttributes,
            PrintAttributes newAttributes,
            CancellationSignal cancellation,
            LayoutResultCallback callback,
            Bundle extras
        ) {
            if (cancellation.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                .build();
            callback.onLayoutFinished(info, !newAttributes.equals(oldAttributes));
        }

        @Override
        public void onWrite(
            PageRange[] pages,
            ParcelFileDescriptor destination,
            CancellationSignal cancellation,
            WriteResultCallback callback
        ) {
            try (FileOutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                out.write(bytes);
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (IOException e) {
                callback.onWriteFailed(e.getMessage());
            }
        }
    }
}
