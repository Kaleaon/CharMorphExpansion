#include <Python.h>

static PyObject *groups_attr = NULL;
static PyObject *group_attr = NULL;
static PyObject *weight_attr = NULL;

PyObject* fast_normalize_weights(PyObject* self, PyObject* args) {
    PyObject *vertices_obj;
    PyObject *deform_indices_set;
    if (!PyArg_ParseTuple(args, "OO", &vertices_obj, &deform_indices_set)) {
        return NULL;
    }

    if (!groups_attr) groups_attr = PyUnicode_InternFromString("groups");
    if (!group_attr) group_attr = PyUnicode_InternFromString("group");
    if (!weight_attr) weight_attr = PyUnicode_InternFromString("weight");

    int is_list = PyList_Check(vertices_obj);
    Py_ssize_t num_verts = is_list ? PyList_GET_SIZE(vertices_obj) : PySequence_Size(vertices_obj);
    if (num_verts <= 0) {
        Py_RETURN_NONE;
    }

    for (Py_ssize_t i = 0; i < num_verts; i++) {
        PyObject *v = is_list ? PyList_GET_ITEM(vertices_obj, i) : PySequence_GetItem(vertices_obj, i);
        if (!v) continue;

        PyObject *groups = PyObject_GetAttr(v, groups_attr);
        if (!is_list) Py_DECREF(v);
        if (!groups) {
            PyErr_Clear();
            continue;
        }

        int g_is_list = PyList_Check(groups);
        Py_ssize_t num_groups = g_is_list ? PyList_GET_SIZE(groups) : PySequence_Size(groups);
        if (num_groups <= 0) {
            Py_DECREF(groups);
            continue;
        }

        double total_w = 0.0;
        int has_deform = 0;
        PyObject *deform_groups[64];
        double deform_weights[64];
        int deform_count = 0;

        for (Py_ssize_t j = 0; j < num_groups; j++) {
            PyObject *g = g_is_list ? PyList_GET_ITEM(groups, j) : PySequence_GetItem(groups, j);
            if (!g) continue;

            PyObject *grp_id = PyObject_GetAttr(g, group_attr);
            if (!g_is_list) Py_DECREF(g);
            if (grp_id) {
                if (PySet_Contains(deform_indices_set, grp_id) == 1) {
                    PyObject *w_obj = PyObject_GetAttr(g, weight_attr);
                    if (w_obj) {
                        double w = PyFloat_AsDouble(w_obj);
                        Py_DECREF(w_obj);
                        total_w += w;
                        has_deform = 1;
                        if (deform_count < 64) {
                            deform_groups[deform_count] = g;
                            deform_weights[deform_count] = w;
                            deform_count++;
                        }
                    }
                }
                Py_DECREF(grp_id);
            }
        }

        if (has_deform && total_w > 1.0) {
            double scale = 1.0 / total_w;
            for (int k = 0; k < deform_count; k++) {
                PyObject *new_w = PyFloat_FromDouble(deform_weights[k] * scale);
                PyObject_SetAttr(deform_groups[k], weight_attr, new_w);
                Py_DECREF(new_w);
            }
        }
        Py_DECREF(groups);
    }

    Py_RETURN_NONE;
}

static PyMethodDef FastWeightMethods[] = {
    {"fast_normalize_weights", fast_normalize_weights, METH_VARARGS, "Fast weight normalization"},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef fastweightmodule = {
    PyModuleDef_HEAD_INIT,
    "c_fast_weight",
    NULL,
    -1,
    FastWeightMethods
};

PyMODINIT_FUNC PyInit_c_fast_weight(void) {
    return PyModule_Create(&fastweightmodule);
}
